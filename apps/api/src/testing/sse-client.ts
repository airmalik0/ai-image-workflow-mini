import { runEventSchema } from '@workflow/contracts'
import type { RunEvent } from '@workflow/contracts'

export interface SseFrame {
  id: string | null
  data: string | null
  comment: string | null
}

/**
 * Минимальный клиент SSE поверх `fetch`: в Node нет `EventSource`, а проверять
 * поток надо именно на сокете — `inject` дожидается конца ответа, которого
 * у бесконечного потока нет.
 *
 * Клиент нарочно не умнее протокола: он показывает кадры как есть, вместе
 * с полем `id` и комментариями-пульсами, — иначе тест не отличит поток
 * с докачкой от потока без неё.
 */
export class SseClient {
  readonly frames: SseFrame[] = []
  readonly events: RunEvent[] = []
  readonly #controller = new AbortController()
  #buffer = ''
  #done: Promise<void> = Promise.resolve()

  static async open(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
    const client = new SseClient()
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream', ...headers },
      signal: client.#controller.signal,
    })
    if (!response.ok || response.body === null) {
      throw new Error(`SSE не открылся: ${response.status} ${await response.text()}`)
    }
    client.#done = client.#read(response.body)
    return client
  }

  /** Ждёт, пока придёт нужное число событий (комментарии-пульсы не считаются). */
  async waitForEvents(count: number, timeoutMs = 5_000): Promise<RunEvent[]> {
    await this.#waitFor(() => this.events.length >= count, timeoutMs)
    return this.events
  }

  async waitForComment(timeoutMs = 5_000): Promise<void> {
    await this.#waitFor(() => this.frames.some((frame) => frame.comment !== null), timeoutMs)
  }

  async close(): Promise<void> {
    this.#controller.abort()
    await this.#done
  }

  async #waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!done()) {
      if (Date.now() > deadline) {
        throw new Error(`не дождались: получено ${this.events.length} событий`)
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  async #read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        this.#buffer += decoder.decode(chunk.value, { stream: true })
        this.#drain()
      }
    } catch {
      // обрыв по abort — штатное завершение теста
    }
  }

  #drain(): void {
    for (;;) {
      const boundary = this.#buffer.indexOf('\n\n')
      if (boundary === -1) return
      const block = this.#buffer.slice(0, boundary)
      this.#buffer = this.#buffer.slice(boundary + 2)
      this.#push(block)
    }
  }

  #push(block: string): void {
    const frame: SseFrame = { id: null, data: null, comment: null }
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) frame.comment = line.slice(1).trim()
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim()
      else if (line.startsWith('data:')) frame.data = line.slice(5).trim()
    }
    this.frames.push(frame)

    if (frame.data === null) return
    const parsed = runEventSchema.safeParse(JSON.parse(frame.data))
    if (parsed.success) this.events.push(parsed.data)
  }
}
