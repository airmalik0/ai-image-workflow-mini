import { RUN_CANCEL_CHANNEL, runCancelledKey } from '@workflow/api'
import type { Redis } from 'ioredis'

/**
 * Источник отмены для исполняющегося job'а.
 *
 * `AbortSignal` через очередь не проходит — он не сериализуется, — поэтому
 * контроллер заводит воркер, а отмена приезжает двумя путями: рассылкой
 * (прерывает уже работающие) и флагом в Redis (ловит job, взятый в ту же
 * миллисекунду, когда рассылка уже прошла).
 */
export interface CancellationSource {
  isCancelled(runId: string): Promise<boolean>
  /** Заводит контроллер на время исполнения задания. */
  track(runId: string): AbortController
  release(runId: string, controller: AbortController): void
}

export interface RedisCancellationOptions {
  /** Обычный клиент: проверка флага. */
  redis: Redis
  /** Отдельное соединение под подписку: в режиме subscribe обычные команды запрещены. */
  subscriber: Redis
}

export class RedisCancellation implements CancellationSource {
  readonly #redis: Redis
  readonly #subscriber: Redis
  readonly #active = new Map<string, Set<AbortController>>()

  constructor(options: RedisCancellationOptions) {
    this.#redis = options.redis
    this.#subscriber = options.subscriber
    this.#subscriber.on('message', (_channel: string, raw: string) => {
      this.#abort(raw)
    })
  }

  async start(): Promise<void> {
    // канал один на все запуски: подписываться на канал каждого run'а означало бы
    // держать в воркере столько подписок, сколько запусков было за день
    await this.#subscriber.subscribe(RUN_CANCEL_CHANNEL)
  }

  async close(): Promise<void> {
    this.#active.clear()
    await this.#subscriber.quit()
  }

  async isCancelled(runId: string): Promise<boolean> {
    return (await this.#redis.exists(runCancelledKey(runId))) === 1
  }

  track(runId: string): AbortController {
    const controller = new AbortController()
    const controllers = this.#active.get(runId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.#active.set(runId, controllers)
    return controller
  }

  release(runId: string, controller: AbortController): void {
    const controllers = this.#active.get(runId)
    if (!controllers) return
    controllers.delete(controller)
    if (controllers.size === 0) this.#active.delete(runId)
  }

  #abort(raw: string): void {
    let runId: unknown
    try {
      runId = (JSON.parse(raw) as { runId?: unknown }).runId
    } catch {
      return
    }
    if (typeof runId !== 'string') return
    for (const controller of this.#active.get(runId) ?? []) controller.abort()
    this.#active.delete(runId)
  }
}
