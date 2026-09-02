import type { DispatchPayload, JobOutcome } from '@workflow/core'
import { Queue, Worker } from 'bullmq'
import type { ConnectionOptions, Processor, WorkerOptions } from 'bullmq'
import { Redis } from 'ioredis'

/** Очередь заданий: оркестратор пишет, воркеры читают. */
export const JOBS_QUEUE = 'workflow-jobs'

/**
 * Обратная очередь: воркер пишет результат, оркестратор читает.
 *
 * Именно очередь, а не pub/sub. Результат job'а — единственное, что двигает граф
 * дальше; потерянное сообщение означает run, зависший навсегда. Pub/sub ничего
 * не гарантирует: если API в этот момент переподключался, событие исчезнет
 * бесследно. У очереди есть подтверждение и повторная доставка.
 */
export const OUTCOMES_QUEUE = 'workflow-job-outcomes'

/** Имя задания внутри очереди. BullMQ требует его при `add`. */
export const EXECUTE_NODE = 'execute-node'

/** Широковещательный канал отмены: один на все запуски, фильтрация по runId у подписчика. */
export const RUN_CANCEL_CHANNEL = 'run-cancel'

/**
 * Флаг отмены. Нужен вдобавок к широковещанию: job мог быть взят воркером
 * в ту же миллисекунду, когда пришла отмена, и тогда рассылку он уже не услышит,
 * а флаг — увидит.
 */
export const runCancelledKey = (runId: string): string => `run:${runId}:cancelled`

/** Идентификаторы заданий запуска — чтобы снять из очереди ещё не начатые. */
export const runJobsKey = (runId: string): string => `run:${runId}:jobs`

/** Попытки BullMQ на транзиентных ошибках. Ручной retry пользователя к ним не относится. */
export const DEFAULT_JOB_ATTEMPTS = 3

/** База экспоненциальной задержки между попытками. */
export const DEFAULT_BACKOFF_MS = 1000

/** Сколько живёт флаг отмены: заведомо дольше самой долгой генерации. */
export const CANCEL_FLAG_TTL_SECONDS = 3600

/** Результат исполнения ноды по дороге от воркера к оркестратору. */
export interface JobOutcomeMessage {
  runId: string
  nodeId: string
  jobId: string
  attempt: number
  outcome: JobOutcome
}

/**
 * Клиент Redis для BullMQ.
 *
 * `maxRetriesPerRequest: null` — требование BullMQ: блокирующие команды воркера
 * живут дольше любого разумного числа попыток, и с дефолтным значением ioredis
 * рвёт их на переподключении.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false })
}

/**
 * Настройки соединения для очередей. Передаётся именно объект, а не готовый
 * клиент: тогда соединение заводит и закрывает сама BullMQ, и `queue.close()`
 * не оставляет висящего сокета. Клиент, созданный снаружи, она принципиально
 * не закрывает — считает чужим.
 */
export function redisConnection(url: string): ConnectionOptions {
  return { url, maxRetriesPerRequest: null }
}

export function createJobsQueue(connection: ConnectionOptions): Queue<DispatchPayload> {
  return new Queue<DispatchPayload>(JOBS_QUEUE, { connection })
}

export function createOutcomesQueue(connection: ConnectionOptions): Queue<JobOutcomeMessage> {
  return new Queue<JobOutcomeMessage>(OUTCOMES_QUEUE, { connection })
}

/**
 * Потребитель результатов на стороне API. Конкурентность 1: движок всё равно
 * сериализует свои операции, а параллельная доставка только добавила бы гонок
 * там, где их нет.
 */
export function createOutcomesWorker(
  connection: ConnectionOptions,
  handler: (message: JobOutcomeMessage) => Promise<void>,
  options: Partial<WorkerOptions> = {},
): Worker<JobOutcomeMessage> {
  const processor: Processor<JobOutcomeMessage, void> = async (job) => {
    await handler(job.data)
  }
  return new Worker<JobOutcomeMessage, void>(OUTCOMES_QUEUE, processor, {
    connection,
    concurrency: 1,
    ...options,
  })
}

/**
 * Идентификатор задания. Детерминированный, с номером попытки: повторная
 * постановка той же ноды в той же попытке (перезапуск API, дубль сообщения)
 * не создаёт второго задания, а ручной retry увеличивает `attempt` и потому
 * не натыкается на «такой job уже был».
 *
 * Двоеточие в идентификаторе BullMQ запрещает (проверено вживую: `add` падает
 * с «Custom Id cannot contain :»), а идентификатор ноды приходит из графа
 * и содержать может что угодно. Поэтому части экранируются, а разделителем
 * взята тильда: `encodeURIComponent` её не трогает, значит она не появится
 * внутри части и не склеит две разные ноды в один идентификатор.
 */
export function jobIdOf(payload: Pick<DispatchPayload, 'runId' | 'nodeId' | 'attempt'>): string {
  return `${escapeIdPart(payload.runId)}~${escapeIdPart(payload.nodeId)}~${payload.attempt}`
}

export function escapeIdPart(value: string): string {
  return encodeURIComponent(value).replaceAll('~', '%7E')
}
