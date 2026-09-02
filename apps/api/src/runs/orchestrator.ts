import type { Job, Run, RunStatus } from '@workflow/contracts'
import { RunEngine } from '@workflow/core'
import type { Clock, JobDispatcher, JobOutcome, RunRepository } from '@workflow/core'
import type { RunEventBus, RunEventInput } from '../realtime/event-bus.js'

/** Минимум логгера, который нужен оркестратору: он только сообщает о сбое публикации. */
export interface OrchestratorLogger {
  error(context: Record<string, unknown>, message: string): void
}

export interface RunOrchestratorDeps {
  runs: RunRepository
  dispatcher: JobDispatcher
  events: RunEventBus
  maxConcurrency: number
  clock?: Clock
  logger?: OrchestratorLogger
}

export interface RunOrchestrator {
  start(runId: string): Promise<void>
  cancel(runId: string): Promise<void>
  retry(runId: string, nodeId: string): Promise<void>
  /** Ответ исполнителя: пришёл из очереди результатов. */
  onJobFinished(runId: string, nodeId: string, outcome: JobOutcome): Promise<void>
  /** Дождаться, пока разойдутся все начатые публикации. Нужен тестам и остановке сервиса. */
  drainEvents(): Promise<void>
}

const TERMINAL: readonly RunStatus[] = ['completed', 'failed', 'cancelled']

/**
 * Оркестрация поверх движка: движок считает граф, а здесь его изменения
 * превращаются в события шины.
 *
 * Публикация намеренно не ожидается движком (`jobUpdated`/`runUpdated`
 * синхронные): пересчёт графа не должен вставать из-за медленного Redis.
 * Порядок при этом сохраняется — шина сериализует публикации сама.
 */
export function createRunOrchestrator(deps: RunOrchestratorDeps): RunOrchestrator {
  const pending = new Set<Promise<void>>()
  /** Предыдущий статус запуска: `run.started` и `run.finished` — это переходы, а не состояния. */
  const lastStatus = new Map<string, RunStatus>()

  const emit = (event: RunEventInput): void => {
    const promise = deps.events.publish(event).then(
      () => undefined,
      (error: unknown) => {
        deps.logger?.error(
          { err: error, runId: event.runId, type: event.type },
          'событие не опубликовано',
        )
      },
    )
    pending.add(promise)
    void promise.finally(() => pending.delete(promise))
  }

  const onJobUpdated = (job: Job): void => {
    // в поток идёт fileId, а не картинка: base64 раздувал бы каждое переподключение
    emit({ type: 'job.updated', runId: job.runId, job })
  }

  const onRunUpdated = (run: Run): void => {
    const previous = lastStatus.get(run.id)
    if (run.status === previous) return
    lastStatus.set(run.id, run.status)

    if (run.status === 'running') {
      emit({
        type: 'run.started',
        runId: run.id,
        startedAt: run.startedAt ?? new Date().toISOString(),
      })
      return
    }

    if (TERMINAL.includes(run.status)) {
      emit({
        type: 'run.finished',
        runId: run.id,
        status: run.status,
        finishedAt: run.finishedAt ?? new Date().toISOString(),
      })
      // запуск закрыт: держать его статус дальше незачем, а повторный запуск
      // после ручного retry обязан снова выглядеть как переход в running
      lastStatus.delete(run.id)
    }
  }

  const engine = new RunEngine({
    dispatcher: deps.dispatcher,
    repo: deps.runs,
    maxConcurrency: deps.maxConcurrency,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    events: { jobUpdated: onJobUpdated, runUpdated: onRunUpdated },
  })

  return {
    start: (runId) => engine.start(runId),
    cancel: (runId) => engine.cancel(runId),
    retry: (runId, nodeId) => engine.retryNode(runId, nodeId),
    onJobFinished: (runId, nodeId, outcome) => engine.onJobFinished(runId, nodeId, outcome),
    drainEvents: async () => {
      while (pending.size > 0) await Promise.all([...pending])
    },
  }
}
