import { runEventSchema } from '@workflow/contracts'
import type { RunEvent } from '@workflow/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToEvents } from './sse'
import type { SseStatus } from './sse'

/**
 * Подмена `EventSource`: в jsdom его нет, а нам нужно управлять и разрывом, и тем,
 * что сервер пришлёт после переподключения.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  /** Сообщение из потока: `id:` в SSE — это `seq` события. */
  emit(event: RunEvent) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(event), lastEventId: String(event.seq) }),
    )
  }

  /** Сервер ответил не 200 — браузер закрывает поток и сам не переподключается. */
  fail() {
    this.readyState = 2
    this.onerror?.()
  }

  close() {
    this.closed = true
    this.readyState = 2
  }
}

const jobEvent = (seq: number, status: 'running' | 'success'): RunEvent => ({
  type: 'job.updated',
  seq,
  runId: 'run-1',
  job: {
    id: `job-${seq}`,
    runId: 'run-1',
    nodeId: 'generateImage-1',
    status,
    attempt: 0,
    startedAt: '2026-09-02T10:00:00.000Z',
    finishedAt: null,
    output: null,
    error: null,
  },
})

const last = () => {
  const source = FakeEventSource.instances.at(-1)
  if (!source) throw new Error('EventSource не создан')
  return source
}

describe('SSE-подписка', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const subscribe = (received: RunEvent[], statuses: SseStatus[] = []) =>
    subscribeToEvents<RunEvent>({
      path: '/runs/run-1/events',
      schema: runEventSchema,
      seqOf: (event) => event.seq,
      onEvent: (event) => received.push(event),
      onStatus: (status) => statuses.push(status),
      retryDelayMs: 500,
    })

  it('переподключение с Last-Event-ID не теряет и не дублирует события', () => {
    const received: RunEvent[] = []
    const subscription = subscribe(received)

    last().open()
    last().emit(jobEvent(1, 'running'))
    last().emit(jobEvent(2, 'running'))

    // обрыв: сервер ответил не 200, браузер сам переподключаться не будет
    last().fail()
    vi.advanceTimersByTime(500)

    expect(FakeEventSource.instances).toHaveLength(2)
    expect(last().url).toBe('/api/runs/run-1/events?lastEventId=2')

    // докачка отдаёт последнее подтверждённое событие ещё раз, а следом — новое
    last().open()
    last().emit(jobEvent(2, 'running'))
    last().emit(jobEvent(3, 'success'))

    expect(received.map((event) => event.seq)).toEqual([1, 2, 3])
    subscription.close()
  })

  it('пока браузер переподключается сам, второе соединение не открывается', () => {
    const received: RunEvent[] = []
    const statuses: SseStatus[] = []
    const subscription = subscribe(received, statuses)

    last().open()
    // readyState = CONNECTING: браузер переподключится сам и пришлёт Last-Event-ID заголовком
    last().readyState = 0
    last().onerror?.()
    vi.advanceTimersByTime(2000)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting'])
    subscription.close()
  })

  it('битое сообщение не роняет поток', () => {
    const received: RunEvent[] = []
    const invalid: string[] = []
    const subscription = subscribeToEvents<RunEvent>({
      path: '/runs/run-1/events',
      schema: runEventSchema,
      seqOf: (event) => event.seq,
      onEvent: (event) => received.push(event),
      onInvalidEvent: (raw) => invalid.push(raw),
    })

    last().onmessage?.(new MessageEvent('message', { data: '{не json' }))
    last().onmessage?.(new MessageEvent('message', { data: '{"type":"job.updated"}' }))
    last().emit(jobEvent(1, 'running'))

    expect(invalid).toHaveLength(2)
    expect(received.map((event) => event.seq)).toEqual([1])
    subscription.close()
  })

  it('поток, который ни разу не открылся, перестаёт переподключаться и объявляет отказ', () => {
    const received: RunEvent[] = []
    const statuses: SseStatus[] = []
    const subscription = subscribeToEvents<RunEvent>({
      path: '/runs/run-1/events',
      schema: runEventSchema,
      seqOf: (event) => event.seq,
      onEvent: (event) => received.push(event),
      onStatus: (status) => statuses.push(status),
      retryDelayMs: 500,
      maxAttempts: 3,
    })

    // сервер отвечает 404 на удалённый run: браузер закрывает поток каждый раз
    for (let attempt = 0; attempt < 3; attempt += 1) {
      last().fail()
      vi.advanceTimersByTime(500)
    }

    expect(FakeEventSource.instances).toHaveLength(3)
    expect(statuses.at(-1)).toBe('failed')

    // после отказа таймер не тикает и новых соединений не появляется
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(3)

    subscription.close()
  })

  it('успешное открытие обнуляет счётчик попыток — обрыв посреди запуска не тратит лимит', () => {
    const received: RunEvent[] = []
    const statuses: SseStatus[] = []
    const subscription = subscribeToEvents<RunEvent>({
      path: '/runs/run-1/events',
      schema: runEventSchema,
      seqOf: (event) => event.seq,
      onEvent: (event) => received.push(event),
      onStatus: (status) => statuses.push(status),
      retryDelayMs: 500,
      maxAttempts: 2,
    })

    // обрыв — переподключение — успех, и так пять раз подряд: лимит в две попытки
    // не исчерпывается, потому что поток каждый раз открывался
    for (let cycle = 0; cycle < 5; cycle += 1) {
      last().open()
      last().fail()
      vi.advanceTimersByTime(500)
    }

    expect(FakeEventSource.instances).toHaveLength(6)
    expect(statuses).not.toContain('failed')

    subscription.close()
  })

  it('close закрывает соединение и отменяет отложенное переподключение', () => {
    const received: RunEvent[] = []
    const subscription = subscribe(received)

    last().fail()
    subscription.close()
    vi.advanceTimersByTime(5000)

    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
