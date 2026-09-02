import type { RunEvent } from '@workflow/contracts'
import type {
  RunEventBus,
  RunEventHandler,
  RunEventInput,
  RunEventSubscription,
} from '../realtime/event-bus.js'
import { RUN_EVENT_HISTORY_LIMIT } from '../realtime/event-bus.js'

/**
 * Шина без Redis — для тестов роутов, где очередь и сеть только мешают.
 * Семантика та же, что у боевой: `seq` присваивается здесь, история кольцевая
 * и retry её не очищает.
 */
export class InMemoryRunEventBus implements RunEventBus {
  readonly #history = new Map<string, RunEvent[]>()
  readonly #handlers = new Map<string, Set<RunEventHandler>>()
  readonly #limit: number
  #seq = 0

  constructor(limit: number = RUN_EVENT_HISTORY_LIMIT) {
    this.#limit = limit
  }

  /** Всё, что было опубликовано, в порядке публикации — удобно для утверждений в тестах. */
  get published(): RunEvent[] {
    return [...this.#history.values()].flat().sort((a, b) => a.seq - b.seq)
  }

  publish(event: RunEventInput): Promise<RunEvent> {
    this.#seq += 1
    const full = { ...event, seq: this.#seq } as RunEvent

    const history = this.#history.get(event.runId) ?? []
    history.push(full)
    if (history.length > this.#limit) history.splice(0, history.length - this.#limit)
    this.#history.set(event.runId, history)

    for (const handler of this.#handlers.get(event.runId) ?? []) handler(full)
    return Promise.resolve(full)
  }

  subscribe(runId: string, handler: RunEventHandler): Promise<RunEventSubscription> {
    const handlers = this.#handlers.get(runId) ?? new Set<RunEventHandler>()
    handlers.add(handler)
    this.#handlers.set(runId, handlers)
    return Promise.resolve({
      close: () => {
        handlers.delete(handler)
        return Promise.resolve()
      },
    })
  }

  history(runId: string, afterSeq: number): Promise<RunEvent[]> {
    return Promise.resolve((this.#history.get(runId) ?? []).filter((event) => event.seq > afterSeq))
  }

  close(): Promise<void> {
    this.#handlers.clear()
    return Promise.resolve()
  }
}
