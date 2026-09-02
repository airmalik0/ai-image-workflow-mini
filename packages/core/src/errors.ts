import { ERROR_CODES } from '@workflow/contracts'
import type { ErrorCode, JobError } from '@workflow/contracts'

/**
 * Ошибка домена с машиночитаемым кодом из общего списка контрактов.
 * Наружу такая ошибка отдаётся единым конвертом `{ error: { code, message } }`,
 * поэтому свой список кодов ядро не заводит.
 */
export class DomainError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DomainError'
    this.code = code
  }
}

/**
 * Ошибка внешнего провайдера изображений, приведённая к единому виду.
 *
 * `retryable` — решение адаптера, а не догадка вызывающего: только он знает,
 * что в его протоколе транзиентно. У Gemini, например, 429 бывает двух видов —
 * с `RetryInfo` (квота в минуту, повторять) и без него (кончились деньги, повторять
 * бессмысленно), и различить их можно только внутри адаптера.
 *
 * `retryAfterMs` заполняется, когда провайдер сам назвал задержку до повтора.
 */
export class ProviderError extends DomainError {
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(
    code: ErrorCode,
    message: string,
    retryable: boolean,
    options?: { cause?: unknown; retryAfterMs?: number | null },
  ) {
    super(code, message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ProviderError'
    this.retryable = retryable
    this.retryAfterMs = options?.retryAfterMs ?? null
  }
}

/**
 * Повторять ли попытку. Решение принимается по флагу, а не по тексту ошибки —
 * иначе смена формулировки у провайдера ломает политику ретраев.
 *
 * Неклассифицированная ошибка транзиентной не считается: молча повторять то,
 * чего мы не поняли, — самый дорогой способ сжечь квоту.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable
}

const FALLBACK_CODE: ErrorCode = 'PROVIDER_UNAVAILABLE'

/** Приведение любой пойманной ошибки к тому виду, в котором она ложится в job. */
export function toJobError(error: unknown): JobError {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message, retryable: false }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: FALLBACK_CODE, message, retryable: false }
}

/** Код известен списку контрактов — используется при разборе ответов внешних систем. */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
}
