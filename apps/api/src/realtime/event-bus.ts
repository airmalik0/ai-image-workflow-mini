import { runEventChannel, runEventSchema } from '@workflow/contracts'
import type { RunEvent } from '@workflow/contracts'
import type { Redis } from 'ioredis'

/**
 * Событие без `seq`: номер присваивает шина, и только она. Если бы его ставил
 * движок, два процесса-издателя выдали бы одинаковые номера, и докачка по
 * `Last-Event-ID` начала бы терять события.
 */
type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never

export type RunEventInput = WithoutSeq<RunEvent>

export interface RunEventSubscription {
  close(): Promise<void>
}

export type RunEventHandler = (event: RunEvent) => void

/**
 * Шина событий запуска. Источник истины — Redis: подписчик SSE может сидеть
 * на одном инстансе API, а оркестратор работать на другом.
 */
export interface RunEventBus {
  publish(event: RunEventInput): Promise<RunEvent>
  subscribe(runId: string, handler: RunEventHandler): Promise<RunEventSubscription>
  /** События запуска с номером строго больше `afterSeq`. `-1` — вся сохранённая история. */
  history(runId: string, afterSeq: number): Promise<RunEvent[]>
  close(): Promise<void>
}

/** Сколько событий одного запуска держится для догоняющего подписчика. */
export const RUN_EVENT_HISTORY_LIMIT = 500

/** Сколько история живёт: сутки — с запасом на «вернулся к вкладке утром». */
export const RUN_EVENT_TTL_SECONDS = 24 * 3600

export const runHistoryKey = (runId: string): string => `run-events:${runId}:history`
export const runSeqKey = (runId: string): string => `run-events:${runId}:seq`

export interface RedisRunEventBusOptions {
  /** Издатель и хранилище истории. Соединение общее, шина его не закрывает. */
  redis: Redis
  /** Отдельное соединение под подписку: в режиме subscribe обычные команды запрещены. */
  subscriber: Redis
  historyLimit?: number
  ttlSeconds?: number
  /** Событие, которое не разобралось. Поток при этом не рвётся. */
  onInvalidEvent?: (raw: string, error: unknown) => void
}

/**
 * Шина на Redis pub/sub с кольцевым буфером истории.
 *
 * Три решения, без которых докачка не работает:
 *
 * 1. `seq` присваивается атомарным `INCR` — номера не повторяются даже при
 *    нескольких издателях.
 * 2. История пишется до рассылки и **не очищается при retry**: клиент,
 *    подключившийся после падения ноды, обязан узнать, что она падала.
 * 3. Публикации сериализованы в одну цепочку. Иначе два события, отправленные
 *    подряд, могли бы получить номера в обратном порядке, и подписчик,
 *    отсекающий по возрастанию `seq`, молча потерял бы одно из них.
 */
export class RedisRunEventBus implements RunEventBus {
  readonly #redis: Redis
  readonly #subscriber: Redis
  readonly #limit: number
  readonly #ttl: number
  readonly #onInvalidEvent: ((raw: string, error: unknown) => void) | undefined
  readonly #handlers = new Map<string, Set<RunEventHandler>>()
  #chain: Promise<unknown> = Promise.resolve()

  constructor(options: RedisRunEventBusOptions) {
    this.#redis = options.redis
    this.#subscriber = options.subscriber
    this.#limit = options.historyLimit ?? RUN_EVENT_HISTORY_LIMIT
    this.#ttl = options.ttlSeconds ?? RUN_EVENT_TTL_SECONDS
    this.#onInvalidEvent = options.onInvalidEvent
    this.#subscriber.on('message', (channel: string, raw: string) => {
      this.#deliver(channel, raw)
    })
  }

  publish(event: RunEventInput): Promise<RunEvent> {
    const result = this.#chain.then(
      () => this.#publishNow(event),
      () => this.#publishNow(event),
    )
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async subscribe(runId: string, handler: RunEventHandler): Promise<RunEventSubscription> {
    const channel = runEventChannel(runId)
    let handlers = this.#handlers.get(channel)
    if (!handlers) {
      handlers = new Set()
      this.#handlers.set(channel, handlers)
      // одно соединение на все подписки: вкладок у пользователя может быть много,
      // а соединений к Redis столько же быть не должно
      await this.#subscriber.subscribe(channel)
    }
    handlers.add(handler)

    return {
      close: async () => {
        const current = this.#handlers.get(channel)
        if (!current) return
        current.delete(handler)
        if (current.size > 0) return
        this.#handlers.delete(channel)
        await this.#subscriber.unsubscribe(channel)
      },
    }
  }

  async history(runId: string, afterSeq: number): Promise<RunEvent[]> {
    const raw = await this.#redis.lrange(runHistoryKey(runId), 0, -1)
    const events: RunEvent[] = []
    for (const item of raw) {
      const event = this.#parse(item)
      if (event && event.seq > afterSeq) events.push(event)
    }
    return events
  }

  async close(): Promise<void> {
    this.#handlers.clear()
    await this.#subscriber.quit()
  }

  async #publishNow(event: RunEventInput): Promise<RunEvent> {
    const { runId } = event
    const seq = await this.#redis.incr(runSeqKey(runId))
    const full = { ...event, seq } as RunEvent
    const payload = JSON.stringify(full)

    await this.#redis
      .multi()
      .rpush(runHistoryKey(runId), payload)
      .ltrim(runHistoryKey(runId), -this.#limit, -1)
      .expire(runHistoryKey(runId), this.#ttl)
      .expire(runSeqKey(runId), this.#ttl)
      .publish(runEventChannel(runId), payload)
      .exec()

    return full
  }

  #deliver(channel: string, raw: string): void {
    const handlers = this.#handlers.get(channel)
    if (!handlers || handlers.size === 0) return
    const event = this.#parse(raw)
    if (!event) return
    for (const handler of handlers) handler(event)
  }

  /** Чужое или битое сообщение в канале не должно ронять подписчиков. */
  #parse(raw: string): RunEvent | null {
    try {
      const parsed = runEventSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
      this.#onInvalidEvent?.(raw, parsed.error)
    } catch (error) {
      this.#onInvalidEvent?.(raw, error)
    }
    return null
  }
}
