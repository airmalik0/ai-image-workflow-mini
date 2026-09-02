import type { ZodType } from 'zod'
import { apiUrl } from './http'
import type { QueryParams } from './types'

/**
 * `failed` — поток так и не открылся за отведённое число попыток и больше
 * не переподключается. Отдельное значение, а не `closed`: закрыл подписку
 * вызывающий, а сдался клиент, и путать эти два случая в интерфейсе нельзя.
 */
export type SseStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed'

export interface SseOptions<T> {
  /** Путь от базового адреса API, например `/runs/42/events`. */
  path: string
  /** Схема события из контрактов: в поток не попадает ничего, что ей не подходит. */
  schema: ZodType<T>
  /**
   * Монотонный номер события в пределах потока. По нему отсекаются повторы:
   * после разрыва сервер отдаёт историю от подтверждённой позиции, и часть
   * событий приходит второй раз.
   */
  seqOf: (event: T) => number
  onEvent: (event: T) => void
  onStatus?: ((status: SseStatus) => void) | undefined
  /** Сообщение, которое не разобралось. Поток при этом не рвётся. */
  onInvalidEvent?: ((raw: string, error: unknown) => void) | undefined
  /** Пауза перед собственной попыткой переподключения. */
  retryDelayMs?: number | undefined
  /**
   * Сколько раз подряд пробуем открыть поток, ни разу его не открыв. Успешное
   * открытие обнуляет счётчик, поэтому обрывы посреди долгого запуска лимит
   * не тратят.
   */
  maxAttempts?: number | undefined
  query?: QueryParams | undefined
}

export interface SseSubscription {
  close: () => void
}

/** `EventSource.CLOSED`: браузер сдался и сам переподключаться не будет. */
const CLOSED = 2

const DEFAULT_RETRY_DELAY = 1000

/**
 * Потолок попыток открыть поток. Нужен ровно для одного случая: run удалён
 * или его никогда не было, сервер отвечает 404, и переподключение раз в секунду
 * длилось бы столько же, сколько открыта вкладка.
 */
const DEFAULT_MAX_ATTEMPTS = 5

/**
 * Подписка на поток событий запуска.
 *
 * Переподключение живёт в два эшелона. Пока `EventSource` в состоянии CONNECTING,
 * переподключается сам браузер — и он же присылает заголовок `Last-Event-ID`,
 * поэтому мешать ему не надо. Если браузер перешёл в CLOSED (например, сервер
 * ответил не 200), соединение создаётся заново уже нами, и позиция докачки
 * передаётся query-параметром: выставить заголовок в `EventSource` нельзя,
 * его API этого не умеет.
 *
 * Дубли отсекаются по `seq`, а не по факту переподключения: сервер вправе
 * повторить последнее подтверждённое событие, и клиент обязан это пережить.
 *
 * Собственные попытки ограничены `maxAttempts`: поток, который ни разу
 * не открылся, — это не временная сетевая неурядица, а отсутствующий ресурс,
 * и вечный цикл переподключений здесь означает только утечку.
 */
export const subscribeToEvents = <T>(options: SseOptions<T>): SseSubscription => {
  const {
    path,
    schema,
    seqOf,
    onEvent,
    onStatus,
    onInvalidEvent,
    retryDelayMs = DEFAULT_RETRY_DELAY,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    query,
  } = options

  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSeq = -1
  let stopped = false
  /** Неудачные попытки открыть поток подряд. Обнуляется первым же `onopen`. */
  let attempts = 0

  const report = (status: SseStatus) => onStatus?.(status)

  const handleMessage = (message: MessageEvent<string>) => {
    let raw: unknown
    try {
      raw = JSON.parse(message.data) as unknown
    } catch (error) {
      onInvalidEvent?.(message.data, error)
      return
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      onInvalidEvent?.(message.data, parsed.error)
      return
    }

    const seq = seqOf(parsed.data)
    if (seq <= lastSeq) return
    lastSeq = seq
    onEvent(parsed.data)
  }

  const connect = () => {
    if (stopped) return

    const resume = lastSeq >= 0 ? { lastEventId: String(lastSeq) } : {}
    report(lastSeq >= 0 ? 'reconnecting' : 'connecting')

    const es = new EventSource(apiUrl(path, { ...query, ...resume }))
    source = es

    es.onopen = () => {
      attempts = 0
      report('open')
    }
    es.onmessage = handleMessage
    es.onerror = () => {
      if (stopped) return
      if (es.readyState !== CLOSED) {
        // Браузер переподключается сам — просто показываем это состояние.
        report('reconnecting')
        return
      }
      es.close()

      attempts += 1
      if (attempts >= maxAttempts) {
        stopped = true
        report('failed')
        return
      }

      report('reconnecting')
      timer = setTimeout(connect, retryDelayMs)
    }
  }

  connect()

  return {
    close: () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      source?.close()
      report('closed')
    },
  }
}
