import type { DispatchPayload, JobDispatcher } from '@workflow/core'
import { Job } from 'bullmq'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import {
  CANCEL_FLAG_TTL_SECONDS,
  DEFAULT_JOB_ATTEMPTS,
  EXECUTE_NODE,
  RUN_CANCEL_CHANNEL,
  jobIdOf,
  runCancelledKey,
  runJobsKey,
} from './queue.js'

export interface BullMqDispatcherOptions {
  queue: Queue<DispatchPayload>
  /** Обычный клиент: флаг отмены, рассылка и учёт поставленных заданий. */
  redis: Redis
  attempts?: number
  cancelTtlSeconds?: number
}

/**
 * Постановка заданий в BullMQ.
 *
 * `dispatch` — только `queue.add`. Ждать здесь результата нельзя: движок
 * сериализует свои операции, и ожидание превратило бы граф из двадцати
 * независимых генераций в двадцать последовательных.
 *
 * `AbortSignal` в задание не кладётся принципиально — он не переживает
 * сериализацию в Redis. Сигнал заводит у себя воркер, а сюда отмена приходит
 * двумя путями: флагом в Redis (для ещё не начатых) и рассылкой (для идущих).
 */
export class BullMqDispatcher implements JobDispatcher {
  readonly #queue: Queue<DispatchPayload>
  readonly #redis: Redis
  readonly #attempts: number
  readonly #cancelTtl: number

  constructor(options: BullMqDispatcherOptions) {
    this.#queue = options.queue
    this.#redis = options.redis
    this.#attempts = options.attempts ?? DEFAULT_JOB_ATTEMPTS
    this.#cancelTtl = options.cancelTtlSeconds ?? CANCEL_FLAG_TTL_SECONDS
  }

  async dispatch(payload: DispatchPayload): Promise<void> {
    const jobId = jobIdOf(payload)

    await this.#queue.add(EXECUTE_NODE, payload, {
      jobId,
      attempts: this.#attempts,
      // «custom» вместо «exponential»: стратегия живёт у воркера и умеет
      // учитывать Retry-After провайдера, о котором очередь ничего не знает
      backoff: { type: 'custom' },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600, count: 1000 },
    })

    // список заданий запуска нужен отмене: BullMQ не умеет «снять всё по признаку»
    await this.#redis.sadd(runJobsKey(payload.runId), jobId)
    await this.#redis.expire(runJobsKey(payload.runId), this.#cancelTtl)
  }

  /**
   * Порядок шагов важен. Сначала флаг — его увидит job, который воркер взял
   * прямо сейчас и который рассылку услышать уже не успевает. Потом рассылка —
   * она прерывает работающие генерации. И только потом снятие из очереди:
   * если сделать это первым, задание успеет уйти воркеру между шагами.
   */
  async cancel(runId: string): Promise<void> {
    await this.#redis.set(runCancelledKey(runId), '1', 'EX', this.#cancelTtl)
    await this.#redis.publish(RUN_CANCEL_CHANNEL, JSON.stringify({ runId }))

    const jobIds = await this.#redis.smembers(runJobsKey(runId))
    for (const jobId of jobIds) {
      const job = await Job.fromId<DispatchPayload>(this.#queue, jobId)
      if (!job) continue
      try {
        await job.remove()
      } catch {
        // задание уже в работе и заблокировано воркером — его снимет AbortSignal,
        // а не удаление из очереди
      }
    }
    await this.#redis.del(runJobsKey(runId))
  }
}
