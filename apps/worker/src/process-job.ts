import { DEFAULT_BACKOFF_MS, EXECUTE_NODE, JOBS_QUEUE, jobIdOf } from '@workflow/api'
import type { JobOutcomeMessage } from '@workflow/api'
import { ProviderError, executeNode, isRetryable, toJobError } from '@workflow/core'
import type { DispatchPayload, ExecutionDeps, JobOutcome } from '@workflow/core'
import { UnrecoverableError, Worker } from 'bullmq'
import type { ConnectionOptions, Queue } from 'bullmq'
import type { CancellationSource } from './cancellation.js'

/** Минимум логгера: воркеру достаточно сообщить о начале и исходе задания. */
export interface JobLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

export interface ProcessJobDeps {
  execution: ExecutionDeps
  /** Обратная очередь: сюда уезжает результат для оркестратора. */
  outcomes: Queue<JobOutcomeMessage>
  cancellation: CancellationSource
  logger?: JobLogger
}

export interface AttemptInfo {
  /** Номер текущей попытки, начиная с 1. */
  number: number
  /** Сколько попыток разрешено очередью. */
  allowed: number
}

/**
 * Исполнение одного задания.
 *
 * Про граф здесь не знает никто: приходит нода с уже разрешёнными входами.
 * Результат уезжает в обратную очередь — и только после этого задание считается
 * закрытым.
 *
 * Два повтора, которые нельзя путать. Транзиентную ошибку до последней попытки
 * мы просто пробрасываем: повторит BullMQ, а оркестратор о ней даже не узнает —
 * иначе нода мигала бы «упала — работает — упала». Окончательный провал
 * публикуется как результат и помечается `UnrecoverableError`, чтобы очередь
 * не повторяла то, что повторять бессмысленно.
 *
 * Тихой подмены упавшего провайдера заглушкой нет и быть не может: ошибка
 * обязана остаться ошибкой, иначе сценарий «нода упала → Retry» невоспроизводим.
 */
export async function processJob(
  deps: ProcessJobDeps,
  payload: DispatchPayload,
  attempt: AttemptInfo,
): Promise<JobOutcome> {
  const context = { runId: payload.runId, jobId: payload.jobId, nodeId: payload.nodeId }

  // отменённый запуск не исполняется: движок уже перевёл его ноды в skipped,
  // и генерация за деньги здесь была бы чистым убытком
  if (await deps.cancellation.isCancelled(payload.runId)) {
    throw new UnrecoverableError(`Запуск «${payload.runId}» отменён`)
  }

  const controller = deps.cancellation.track(payload.runId)
  deps.logger?.info({ ...context, attempt: attempt.number, kind: payload.node.kind }, 'job начат')

  try {
    const output = await executeNode(
      deps.execution,
      payload.node,
      payload.inputs,
      context,
      controller.signal,
    )
    const outcome: JobOutcome = { status: 'success', output }
    await publishOutcome(deps, payload, outcome)
    deps.logger?.info(context, 'job выполнен')
    return outcome
  } catch (error) {
    // прерванное отменой не публикуется и не повторяется: статус уже выставлен
    if (controller.signal.aborted || (await deps.cancellation.isCancelled(payload.runId))) {
      deps.logger?.warn(context, 'job прерван отменой запуска')
      throw new UnrecoverableError(`Запуск «${payload.runId}» отменён`)
    }

    if (isRetryable(error) && attempt.number < attempt.allowed) {
      deps.logger?.warn(
        { ...context, attempt: attempt.number, err: error },
        'транзиентная ошибка, попытку повторит очередь',
      )
      throw error
    }

    const jobError = toJobError(error)
    await publishOutcome(deps, payload, { status: 'error', error: jobError })
    deps.logger?.error({ ...context, code: jobError.code, err: error }, 'job упал окончательно')
    // результат уже уехал оркестратору; очереди повторять нечего
    throw new UnrecoverableError(jobError.message)
  } finally {
    deps.cancellation.release(payload.runId, controller)
  }
}

/**
 * Публикация результата. Идентификатор детерминирован: повторная доставка того же
 * задания не породит второго результата.
 */
async function publishOutcome(
  deps: ProcessJobDeps,
  payload: DispatchPayload,
  outcome: JobOutcome,
): Promise<void> {
  await deps.outcomes.add(
    'job-finished',
    {
      runId: payload.runId,
      nodeId: payload.nodeId,
      jobId: payload.jobId,
      attempt: payload.attempt,
      outcome,
    },
    {
      jobId: `${jobIdOf(payload)}~outcome`,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  )
}

export interface JobWorkerDeps extends ProcessJobDeps {
  connection: ConnectionOptions
  concurrency: number
}

export function createJobWorker(deps: JobWorkerDeps): Worker<DispatchPayload, JobOutcome> {
  return new Worker<DispatchPayload, JobOutcome>(
    JOBS_QUEUE,
    async (job) => {
      if (job.name !== EXECUTE_NODE)
        throw new UnrecoverableError(`Неизвестное задание «${job.name}»`)
      return processJob(deps, job.data, {
        // attemptsStarted считает саму текущую попытку, attemptsMade — только прошлые
        number: job.attemptsStarted,
        allowed: job.opts.attempts ?? 1,
      })
    },
    {
      connection: deps.connection,
      concurrency: deps.concurrency,
      settings: {
        backoffStrategy: (attemptsMade: number, _type?: string, error?: Error) =>
          backoffDelay(attemptsMade, error),
      },
    },
  )
}

/**
 * Задержка перед повтором. Экспонента с джиттером, но если провайдер сам назвал
 * время (`Retry-After` у 429) — ждём не меньше названного: повторить раньше
 * значит получить тот же 429 и сжечь попытку впустую.
 */
export function backoffDelay(attemptsMade: number, error?: unknown): number {
  const exponential = DEFAULT_BACKOFF_MS * 2 ** Math.max(0, attemptsMade - 1)
  const jitter = Math.round(exponential * 0.2 * Math.random())
  const retryAfter = error instanceof ProviderError ? (error.retryAfterMs ?? 0) : 0
  return Math.max(exponential + jitter, retryAfter)
}
