import { ERROR_CODES, errorEnvelopeSchema } from '@workflow/contracts'
import type { ErrorEnvelope } from '@workflow/contracts'

/**
 * Коды ошибок HTTP-слоя.
 *
 * Канонический список живёт в контрактах, но в нём нет кодов, которые появляются
 * только на границе HTTP: маршрут не найден, тело больше лимита, неподдерживаемый
 * тип содержимого. Конверт в контрактах объявлен как `code: z.string()` именно
 * поэтому — сервер вправе расширять словарь, а клиент не обязан ронять разбор
 * ответа на незнакомом коде. Расширение перечислено здесь одним списком,
 * чтобы «где-то в роуте придумали строку» не стало нормой.
 */
export const API_ERROR_CODES = [
  ...ERROR_CODES,
  'PRESET_NOT_FOUND',
  'WORKFLOW_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'BAD_REQUEST',
  'INTERNAL_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** HTTP-код для каждой ошибки. Таблица одна: иначе один и тот же код уедет в разные статусы. */
export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  GRAPH_INVALID: 400,
  VALIDATION_FAILED: 400,
  BAD_REQUEST: 400,
  RUN_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  PRESET_NOT_FOUND: 404,
  WORKFLOW_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PROVIDER_SAFETY_BLOCKED: 422,
  FILE_TOO_LARGE: 413,
  PROVIDER_RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PROVIDER_UNAVAILABLE: 502,
  PROVIDER_TIMEOUT: 504,
}

/**
 * Ошибка, у которой уже есть место в конверте. Роуты бросают её вместо того,
 * чтобы вручную звать `reply.code(...).send(...)`: обработчик ошибок остаётся
 * единственным местом, где формируется тело ответа.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: unknown

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options?.details
  }
}

export function notFound(code: ApiErrorCode, message: string): ApiError {
  return new ApiError(code, message)
}

/** Конверт ответа. `details` не появляется в теле, если его нет — а не приезжает как `null`. */
export function errorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

/**
 * Ответы с ошибкой для схемы роута. Нужны не столько рантайму, сколько OpenAPI:
 * без них в документации у каждого метода только счастливый путь.
 */
export function errorResponses(
  ...statuses: readonly number[]
): Record<number, typeof errorEnvelopeSchema> {
  return Object.fromEntries(statuses.map((status) => [status, errorEnvelopeSchema]))
}
