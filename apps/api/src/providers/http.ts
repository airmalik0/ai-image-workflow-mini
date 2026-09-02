import { ProviderError } from '@workflow/core'

/**
 * Подменяемый `fetch`. Нужен ровно для того, чтобы тесты разбирали зафиксированные
 * тела ответов, не выходя в сеть: CI не должен зависеть от чужого API и жечь квоту.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpCallOptions {
  /** Дедлайн на весь обмен, включая чтение тела: картинка приходит одним куском в конце. */
  timeoutMs: number
  /** Отмена run'а обязана прерывать уже начатый запрос, а не только снимать очередь. */
  signal: AbortSignal
  /** Человекочитаемое имя провайдера для текста ошибки. */
  label: string
}

export interface HttpResult {
  ok: boolean
  status: number
  headers: Headers
  /** Разобранный JSON, либо сырой текст, если провайдер ответил не-JSON (прокси, балансировщик). */
  body: unknown
}

/**
 * Один HTTP-обмен с дедлайном и отменой.
 *
 * Ретраев здесь нет намеренно: повтор — дело очереди job'ов (BullMQ настраивает
 * `attempts` и backoff). Провайдер лишь честно сообщает `retryable` и `retryAfterMs`,
 * иначе повторы будут вложенными и реальное число обращений к платному API
 * перестанет совпадать с настройкой очереди.
 */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  options: HttpCallOptions,
): Promise<HttpResult> {
  const deadline = withDeadline(options.signal, options.timeoutMs)
  try {
    const response = await fetchImpl(url, { ...init, signal: deadline.signal })
    // тело читаем под тем же дедлайном: ответ с картинкой — это мегабайты base64
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      body: parseJson(text),
    }
  } catch (cause) {
    throw toTransportError(cause, options, deadline.timedOut())
  } finally {
    deadline.dispose()
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * Отмена run'а и собственный таймаут — разные ошибки: первую повторять нельзя
 * (пользователь сам остановил запуск), вторую можно и нужно.
 */
function toTransportError(cause: unknown, options: HttpCallOptions, timedOut: boolean): Error {
  if (cause instanceof ProviderError) return cause
  if (options.signal.aborted) {
    return new ProviderError(
      'PROVIDER_TIMEOUT',
      `${options.label}: генерация прервана сигналом отмены`,
      false,
      { cause },
    )
  }
  if (timedOut) {
    return new ProviderError(
      'PROVIDER_TIMEOUT',
      `${options.label}: ответ не получен за ${Math.round(options.timeoutMs / 1000)} с`,
      true,
      { cause },
    )
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ProviderError(
    'PROVIDER_UNAVAILABLE',
    `${options.label}: сетевая ошибка — ${message}`,
    true,
    {
      cause,
    },
  )
}

interface Deadline {
  signal: AbortSignal
  timedOut: () => boolean
  dispose: () => void
}

/** Внешний сигнал отмены + собственный таймаут в одном `AbortSignal`. */
function withDeadline(external: AbortSignal, timeoutMs: number): Deadline {
  const controller = new AbortController()
  let expired = false

  const onAbort = (): void => {
    controller.abort(external.reason)
  }

  if (external.aborted) controller.abort(external.reason)
  else external.addEventListener('abort', onAbort, { once: true })

  const timer = setTimeout(() => {
    expired = true
    controller.abort(new Error('deadline exceeded'))
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer)
      external.removeEventListener('abort', onAbort)
    },
  }
}
