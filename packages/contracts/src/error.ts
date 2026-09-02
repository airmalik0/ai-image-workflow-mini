import { z } from 'zod'

/**
 * Машиночитаемые коды ошибок. Список канонический, но конверт принимает любую строку:
 * клиент не должен ронять разбор ответа только потому, что сервер завёл новый код.
 */
export const ERROR_CODES = [
  'GRAPH_INVALID',
  'RUN_NOT_FOUND',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_SAFETY_BLOCKED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'FILE_NOT_FOUND',
  'VALIDATION_FAILED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export const errorCodeSchema = z.enum(ERROR_CODES)

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>
