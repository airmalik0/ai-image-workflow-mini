import type { Job, JobError, JobOutput, JobStatus, Run } from '@workflow/contracts'
import { DomainError } from '../errors.js'
import type { Clock } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import type { JobDispatcher } from '../ports/job-dispatcher.js'
import type { JobPatch, RunPatch, RunRepository } from '../ports/repositories.js'
import {
  computeReadyJobs,
  computeRetryScope,
  computeRunStatus,
  computeSkipCone,
} from './planner.js'
import { outputsByNode, resolveNodeInputs } from './inputs.js'

/** Чем закончился job у исполнителя. */
export type JobOutcome =
  { status: 'success'; output: JobOutput } | { status: 'error'; error: JobError }

/**
 * Подписка на изменения состояния. Через неё оркестратор публикует события в
 * Redis pub/sub, а тесты дожидаются завершения run'а.
 */
export interface RunEngineEvents {
  jobUpdated?: (job: Job) => void
  runUpdated?: (run: Run) => void
}

export interface RunEngineDeps {
  dispatcher: JobDispatcher
  repo: RunRepository
  clock?: Clock
  /** Сколько job'ов движок держит в исполнении одновременно. */
  maxConcurrency?: number
  events?: RunEngineEvents
}

/**
 * Значение по умолчанию. Ограничение обязательно: граф «один промпт → двадцать
 * генераций» без него превращается в двадцать одновременных запросов к провайдеру
 * и гарантированный 429.
 */
export const DEFAULT_MAX_CONCURRENCY = 4

const PENDING_STATUSES: readonly JobStatus[] = ['idle', 'queued', 'running']

/**
 * Движок исполнения графа: считает, какие ноды готовы, ставит их в исполнение и
 * закрывает run. Про саму генерацию он не знает ничего — этим занят исполнитель
 * за портом `JobDispatcher`.
 *
 * Все операции сериализованы в одну цепочку: пересчёт состояния идёт по очереди,
 * поэтому job не может быть отправлен дважды, а поздний ответ отменённого run'а
 * не переписывает его статус. `dispatch` при этом не ожидается до конца работы —
 * он только ставит задание, иначе никакого параллелизма бы не было.
 */
export class RunEngine {
  readonly #dispatcher: JobDispatcher
  readonly #repo: RunRepository
  readonly #clock: Clock
  readonly #maxConcurrency: number
  readonly #events: RunEngineEvents

  /** Незакрытые run'ы: после освобождения слота подкачиваем работу во все. */
  readonly #active = new Set<string>()
  #inFlight = 0
  #chain: Promise<unknown> = Promise.resolve()

  constructor(deps: RunEngineDeps) {
    this.#dispatcher = deps.dispatcher
    this.#repo = deps.repo
    this.#clock = deps.clock ?? systemClock
    this.#maxConcurrency = Math.max(1, deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)
    this.#events = deps.events ?? {}
  }

  get inFlight(): number {
    return this.#inFlight
  }

  /**
   * Материализует job'ы на КАЖДУЮ ноду графа и запускает первую волну.
   * Без job'а на каждой ноде планировщик считает предка неготовым, и run молча
   * встаёт, не начавшись.
   */
  start(runId: string): Promise<void> {
    return this.#serialize(async () => {
      const run = await this.#requireRun(runId)
      if (run.status === 'running') return
      if (run.status !== 'queued') {
        throw new DomainError('VALIDATION_FAILED', `Запуск «${runId}» уже завершён`)
      }

      await this.#repo.ensureJobs(
        runId,
        run.graph.nodes.map((node) => node.id),
      )
      await this.#patchRun(runId, { status: 'running', startedAt: this.#now() })
      this.#active.add(runId)
      await this.#pumpAll()
    })
  }

  /** Ответ исполнителя. Освобождает слот, раскрывает конус пропуска и подаёт следующие ноды. */
  onJobFinished(runId: string, nodeId: string, outcome: JobOutcome): Promise<void> {
    return this.#serialize(async () => {
      if (this.#inFlight > 0) this.#inFlight -= 1

      const run = await this.#repo.findRun(runId)
      // run уже отменён или закрыт: поздний ответ ничего не меняет
      if (!run || run.status !== 'running') return

      const job = await this.#findJob(runId, nodeId)
      // job сброшен retry'ем или уже закрыт — не переписываем его чужим результатом
      if (!job || job.status !== 'running') return

      if (outcome.status === 'success') {
        await this.#patchJob(runId, nodeId, {
          status: 'success',
          output: outcome.output,
          error: null,
          finishedAt: this.#now(),
        })
      } else {
        await this.#failJob(runId, nodeId, outcome.error)
      }

      await this.#pumpAll()
    })
  }

  /**
   * Ручной retry: сбрасывает ноду и её конус потомков в `idle`.
   * Успешные предки не трогаются — их выходы уже сохранены, пересчитывать
   * их значило бы платить второй раз за ту же картинку.
   */
  retryNode(runId: string, nodeId: string): Promise<void> {
    return this.#serialize(async () => {
      const run = await this.#requireRun(runId)
      if (run.status === 'cancelled') {
        throw new DomainError('VALIDATION_FAILED', `Запуск «${runId}» отменён`)
      }
      const scope = computeRetryScope(run.graph, nodeId)
      const jobs = await this.#repo.listJobs(runId)
      if (!jobs.some((job) => job.nodeId === nodeId)) {
        throw new DomainError('VALIDATION_FAILED', `В запуске нет ноды «${nodeId}»`)
      }
      if (jobs.some((job) => scope.includes(job.nodeId) && job.status === 'running')) {
        throw new DomainError('VALIDATION_FAILED', `Нода «${nodeId}» ещё выполняется`)
      }

      for (const id of scope) {
        await this.#patchJob(runId, id, {
          status: 'idle',
          output: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        })
      }

      await this.#patchRun(runId, { status: 'running', finishedAt: null })
      this.#active.add(runId)
      await this.#pumpAll()
    })
  }

  /**
   * Отмена. Статус run'а выставляется решением оркестратора и защищён от пересчёта:
   * `computeRunStatus` про `cancelled` не знает и знать не должен.
   */
  cancel(runId: string): Promise<void> {
    return this.#serialize(async () => {
      const run = await this.#requireRun(runId)
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return
      }

      for (const job of await this.#repo.listJobs(runId)) {
        if (!PENDING_STATUSES.includes(job.status)) continue
        await this.#patchJob(runId, job.nodeId, { status: 'skipped', finishedAt: this.#now() })
      }
      await this.#patchRun(runId, { status: 'cancelled', finishedAt: this.#now() })
      this.#active.delete(runId)

      // снять из очереди неначатое и прервать уже работающее: сигнал отмены
      // живёт у исполнителя, он же доводит его до HTTP-запроса к провайдеру
      await this.#dispatcher.cancel(runId)
    })
  }

  /** Подкачка работы во все незакрытые run'ы: слот освободился — кто-то должен его занять. */
  async #pumpAll(): Promise<void> {
    for (const runId of [...this.#active]) await this.#pump(runId)
  }

  async #pump(runId: string): Promise<void> {
    const run = await this.#repo.findRun(runId)
    if (!run || run.status !== 'running') {
      this.#active.delete(runId)
      return
    }

    // 1. готовые ноды переходят в очередь: у них все предки success
    for (const nodeId of computeReadyJobs(run.graph, await this.#repo.listJobs(runId))) {
      await this.#patchJob(runId, nodeId, { status: 'queued' })
    }

    // 2. пока есть свободные слоты — отдаём очередь исполнителю
    const jobs = await this.#repo.listJobs(runId)
    const outputs = outputsByNode(jobs)
    const nodesById = new Map(run.graph.nodes.map((node) => [node.id, node]))

    for (const job of jobs) {
      if (this.#inFlight >= this.#maxConcurrency) break
      if (job.status !== 'queued') continue
      const node = nodesById.get(job.nodeId)
      if (!node) continue

      const started = await this.#patchJob(runId, job.nodeId, {
        status: 'running',
        attempt: job.attempt + 1,
        startedAt: this.#now(),
        finishedAt: null,
        error: null,
      })
      this.#inFlight += 1

      try {
        await this.#dispatcher.dispatch({
          runId,
          jobId: started.id,
          nodeId: job.nodeId,
          attempt: started.attempt,
          node,
          inputs: resolveNodeInputs(run.graph, job.nodeId, outputs),
        })
      } catch (error) {
        this.#inFlight -= 1
        await this.#failJob(runId, job.nodeId, {
          code: 'PROVIDER_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        })
      }
    }

    await this.#settle(runId)
  }

  /** Закрытие run'а, когда работать больше не над чем. */
  async #settle(runId: string): Promise<void> {
    let jobs = await this.#repo.listJobs(runId)
    const pending = jobs.filter((job) => PENDING_STATUSES.includes(job.status))

    if (pending.length > 0) {
      // Ничего не в работе, а незавершённые job'ы есть и запустить их нельзя:
      // это тупик (например, цикл, проскочивший валидацию). Молча висеть хуже,
      // чем честно упасть.
      if (this.#inFlight > 0) return
      for (const job of pending) {
        await this.#patchJob(runId, job.nodeId, {
          status: 'skipped',
          finishedAt: this.#now(),
          error: {
            code: 'GRAPH_INVALID',
            message: 'Нода недостижима: её зависимости никогда не будут выполнены',
            retryable: false,
          },
        })
      }
      jobs = await this.#repo.listJobs(runId)
    }

    const status = computeRunStatus(jobs)
    if (status === 'running') return
    await this.#patchRun(runId, { status, finishedAt: this.#now() })
    this.#active.delete(runId)
  }

  /** Ошибка ноды: сама нода в `error`, весь её конус потомков — в `skipped`. */
  async #failJob(runId: string, nodeId: string, error: JobError): Promise<void> {
    await this.#patchJob(runId, nodeId, { status: 'error', error, finishedAt: this.#now() })

    const run = await this.#repo.findRun(runId)
    if (!run) return
    const jobs = new Map((await this.#repo.listJobs(runId)).map((job) => [job.nodeId, job]))

    for (const descendant of computeSkipCone(run.graph, nodeId)) {
      const job = jobs.get(descendant)
      if (!job || !PENDING_STATUSES.includes(job.status)) continue
      await this.#patchJob(runId, descendant, {
        status: 'skipped',
        finishedAt: this.#now(),
        error: {
          code: error.code,
          message: `Пропущена: предшествующая нода «${nodeId}» не выполнена`,
          retryable: false,
        },
      })
    }
  }

  async #patchJob(runId: string, nodeId: string, patch: JobPatch): Promise<Job> {
    const job = await this.#repo.updateJob(runId, nodeId, patch)
    this.#events.jobUpdated?.(job)
    return job
  }

  async #patchRun(runId: string, patch: RunPatch): Promise<Run> {
    const run = await this.#repo.updateRun(runId, patch)
    this.#events.runUpdated?.(run)
    return run
  }

  async #findJob(runId: string, nodeId: string): Promise<Job | undefined> {
    return (await this.#repo.listJobs(runId)).find((job) => job.nodeId === nodeId)
  }

  async #requireRun(runId: string): Promise<Run> {
    const run = await this.#repo.findRun(runId)
    if (!run) throw new DomainError('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)
    return run
  }

  #now(): string {
    return this.#clock.now().toISOString()
  }

  /**
   * Единая очередь операций. Она же защищает от реентрантности: исполнитель может
   * ответить прямо во время `dispatch`, и без очереди этот ответ попал бы в
   * середину пересчёта.
   */
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(operation, operation)
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
