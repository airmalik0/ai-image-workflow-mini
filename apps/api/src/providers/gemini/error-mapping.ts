import { ProviderError } from '@workflow/core'
import { asRecord, readArray, readString, readValue } from '../json.js'

/**
 * Нормализация ошибок Gemini. Все разбираемые здесь формы получены живыми
 * запросами — см. `docs/research/gemini-api.md`, §8.
 *
 * Два места, где наивная реализация ошибается:
 *
 * 1. Отказ модели приходит с **HTTP 200** и без `inlineData` — успешный HTTP
 *    ещё не значит успешную генерацию (`mapGeminiMissingImage`).
 * 2. **429 бывает двух видов.** С `error.details[]` (RetryInfo / QuotaFailure) —
 *    это минутная квота, повторять можно и нужно. Без `details` — кончились
 *    предоплаченные кредиты, повтор только сожжёт ретраи очереди.
 */

/** Значения `finishReason`, при которых картинку не отдали по контентным причинам. */
const SAFETY_FINISH_REASONS: ReadonlySet<string> = new Set([
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'SAFETY',
  'BLOCKLIST',
  'SPII',
])

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 409, 500, 502, 503, 504])

export function mapGeminiHttpError(status: number, body: unknown): ProviderError {
  const message = errorMessage(body)

  if (status === 429) {
    // единственный признак, отличающий минутную квоту от кончившихся денег
    const retryAfterMs = parseRetryDelayMs(body)
    const transient = readArray(body, 'error', 'details').length > 0
    return new ProviderError(
      'PROVIDER_RATE_LIMITED',
      transient
        ? `Gemini: превышена квота запросов — ${message}`
        : `Gemini: запрос отклонён по лимитам биллинга, повтор не поможет — ${message}`,
      transient,
      { retryAfterMs },
    )
  }

  if (status === 400 && hasReason(body, 'API_KEY_INVALID')) {
    return config(`Gemini: неверный API-ключ — ${message}`)
  }

  if (status === 401 || status === 403) {
    return config(`Gemini: доступ к API запрещён — ${message}`)
  }

  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError('VALIDATION_FAILED', `Gemini: запрос отклонён — ${message}`, false)
  }

  if (RETRYABLE_STATUSES.has(status) || status >= 500) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      `Gemini: сервис недоступен (HTTP ${status}) — ${message}`,
      true,
    )
  }

  return new ProviderError(
    'PROVIDER_UNAVAILABLE',
    `Gemini: неожиданный ответ (HTTP ${status}) — ${message}`,
    false,
  )
}

/**
 * HTTP 200, а картинки нет. `finishReason` зависит от модели: на один и тот же
 * запрещённый промпт 2.5/3.1-flash отвечают `NO_IMAGE`, а 3-pro — `IMAGE_SAFETY`,
 * поэтому маппер обязан покрывать весь набор, а не два известных значения.
 */
export function mapGeminiMissingImage(candidate: unknown): ProviderError {
  const finishReason = readString(candidate, 'finishReason') ?? 'NO_IMAGE'
  const finishMessage = readString(candidate, 'finishMessage')
  const details = finishMessage === null ? '' : ` — ${finishMessage}`

  if (SAFETY_FINISH_REASONS.has(finishReason)) {
    return new ProviderError(
      'PROVIDER_SAFETY_BLOCKED',
      `Gemini отклонил запрос по контентной политике (finishReason: ${finishReason})${details}`,
      false,
    )
  }

  return new ProviderError(
    'VALIDATION_FAILED',
    `Gemini не вернул изображение (finishReason: ${finishReason})${details}. ` +
      'Уточните, что именно нужно нарисовать',
    false,
  )
}

/**
 * Задержка до повтора. Заголовка `Retry-After` у Gemini нет — значение лежит
 * либо в `error.details[].retryDelay` («34s»), либо только в тексте сообщения
 * («Please retry in 34.286670503s»).
 */
export function parseRetryDelayMs(body: unknown): number | null {
  for (const detail of readArray(body, 'error', 'details')) {
    const delay = readString(detail, 'retryDelay')
    const parsed = delay === null ? null : parseSeconds(delay)
    if (parsed !== null) return parsed
  }

  const message = readString(body, 'error', 'message')
  const match = message?.match(/retry in ([0-9.]+)s/i)
  return match?.[1] === undefined ? null : parseSeconds(match[1])
}

function parseSeconds(value: string): number | null {
  const seconds = Number.parseFloat(value.endsWith('s') ? value.slice(0, -1) : value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

function config(message: string): ProviderError {
  return new ProviderError('PROVIDER_UNAVAILABLE', message, false)
}

function hasReason(body: unknown, reason: string): boolean {
  return readArray(body, 'error', 'details').some(
    (detail) => readString(detail, 'reason') === reason,
  )
}

/** Текст ошибки: либо гугловый конверт, либо то, что вернул прокси. */
function errorMessage(body: unknown): string {
  const message = readString(body, 'error', 'message')
  if (message !== null) return message
  if (typeof body === 'string') return truncate(body)
  const status = readString(body, 'error', 'status')
  if (status !== null) return status
  return asRecord(readValue(body, 'error')) === null ? 'тело ответа не разобрано' : 'без описания'
}

function truncate(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
}
