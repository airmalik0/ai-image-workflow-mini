import { ProviderError } from '@workflow/core'
import { readString } from '../json.js'

/**
 * Нормализация ошибок OpenAI Images. Конверт единый:
 * `{ error: { message, type, param, code } }` — см. `docs/research/openai-images.md`.
 *
 * Главное различие внутри 429: `rate_limit_exceeded` — это минутный лимит,
 * повторять можно; `insufficient_quota` — кончились деньги на аккаунте,
 * повтор бессмысленен. Различаются они только по `error.code`, HTTP один и тот же.
 */

const SAFETY_CODES: ReadonlySet<string> = new Set([
  'moderation_blocked',
  'content_policy_violation',
])

const BILLING_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
])

const CONFIG_CODES: ReadonlySet<string> = new Set([
  'invalid_api_key',
  'model_not_available',
  'unsupported_country_region_territory',
])

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 409, 500, 502, 503, 504])

export function mapOpenAiHttpError(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): ProviderError {
  const message = errorMessage(body)
  const code = readString(body, 'error', 'code') ?? readString(body, 'error', 'type') ?? ''

  if (status === 429) {
    const billing = BILLING_CODES.has(code)
    return new ProviderError(
      'PROVIDER_RATE_LIMITED',
      billing
        ? `OpenAI: исчерпана квота аккаунта, повтор не поможет — ${message}`
        : `OpenAI: превышен лимит запросов — ${message}`,
      !billing,
      { retryAfterMs: billing ? null : parseRetryAfterMs(retryAfterHeader) },
    )
  }

  if (SAFETY_CODES.has(code)) {
    return new ProviderError(
      'PROVIDER_SAFETY_BLOCKED',
      `OpenAI отклонил запрос по контентной политике — ${message}`,
      false,
    )
  }

  if (status === 401 || status === 403 || CONFIG_CODES.has(code)) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      `OpenAI: доступ к API запрещён — ${message}`,
      false,
    )
  }

  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new ProviderError('VALIDATION_FAILED', `OpenAI: запрос отклонён — ${message}`, false)
  }

  if (RETRYABLE_STATUSES.has(status) || status >= 500) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      `OpenAI: сервис недоступен (HTTP ${status}) — ${message}`,
      true,
    )
  }

  return new ProviderError(
    'PROVIDER_UNAVAILABLE',
    `OpenAI: неожиданный ответ (HTTP ${status}) — ${message}`,
    false,
  )
}

/**
 * `Retry-After` допускает и секунды, и HTTP-дату. Дату не пересчитываем в задержку
 * намеренно: расхождение часов клиента и сервера превращает её в отрицательное или
 * абсурдно большое ожидание — пусть тогда работает обычный backoff очереди.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) return null
  const seconds = Number.parseFloat(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null
}

function errorMessage(body: unknown): string {
  const message = readString(body, 'error', 'message')
  if (message !== null) return message
  if (typeof body === 'string') {
    const trimmed = body.trim()
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
  }
  return 'тело ответа не разобрано'
}
