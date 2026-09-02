import { DomainError } from '@workflow/core'
import type { FastifyError, FastifyInstance } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import type { ApiConfig } from '../config.js'
import type { ApiErrorCode } from '../http/errors.js'
import { ApiError, STATUS_BY_CODE, errorEnvelope } from '../http/errors.js'

interface MappedError {
  status: number
  code: ApiErrorCode | string
  message: string
  details?: unknown
}

/**
 * Единственное место, где ошибка превращается в тело ответа. Роуты бросают
 * `ApiError` или доменную ошибку и ничего не знают про HTTP-коды.
 *
 * Отдельно обрабатываются ошибки схемы: без этого клиент получал бы родной
 * формат Fastify (`{statusCode, error, message}`) на одних ответах и наш конверт
 * на других — и разбирать ошибки на фронте пришлось бы двумя ветками.
 */
export function registerErrorHandler(app: FastifyInstance, config: ApiConfig): void {
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error, config)

    if (mapped.status >= 500) {
      request.log.error({ err: error, code: mapped.code }, 'запрос завершился ошибкой сервера')
    } else {
      request.log.warn({ code: mapped.code, status: mapped.status, err: error }, 'запрос отклонён')
    }

    void reply.code(mapped.status).send(errorEnvelope(mapped.code, mapped.message, mapped.details))
  })

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(
        errorEnvelope('ROUTE_NOT_FOUND', `Маршрут ${request.method} ${request.url} не существует`),
      )
  })
}

function mapError(error: unknown, config: ApiConfig): MappedError {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Тело запроса не соответствует схеме',
      details: { issues: error.validation },
    }
  }

  // Ответ не прошёл собственную схему — это дефект сервера, наружу подробности не идут
  if (isResponseSerializationError(error)) {
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ответ сервера не соответствует собственной схеме',
    }
  }

  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }

  // Доменные ошибки (в том числе ProviderError) уже несут машиночитаемый код
  if (error instanceof DomainError) {
    return { status: STATUS_BY_CODE[error.code], code: error.code, message: error.message }
  }

  const fastifyError = asFastifyError(error)
  if (fastifyError?.statusCode !== undefined && fastifyError.statusCode < 500) {
    // «request file too large» без числа заставляет пользователя гадать, насколько
    // именно велик его файл; лимит известен только здесь, из конфигурации
    if (fastifyError.statusCode === 413) {
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: `Файл больше допустимого размера в ${config.maxUploadBytes} байт`,
        details: { limitBytes: config.maxUploadBytes },
      }
    }
    return {
      status: fastifyError.statusCode,
      code: httpCode(fastifyError.statusCode),
      message: fastifyError.message,
    }
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    // текст внутренней ошибки наружу не отдаётся: в нём бывают строки подключения
    message: 'Внутренняя ошибка сервера',
  }
}

/**
 * Ошибки самого Fastify (разбор JSON, превышение лимита тела, чужой content-type)
 * приходят без нашего кода — он выводится из статуса, чтобы конверт оставался одним.
 */
function httpCode(status: number): ApiErrorCode {
  if (status === 413) return 'FILE_TOO_LARGE'
  if (status === 415 || status === 406) return 'UNSUPPORTED_MEDIA_TYPE'
  if (status === 404) return 'ROUTE_NOT_FOUND'
  return 'BAD_REQUEST'
}

function asFastifyError(error: unknown): FastifyError | null {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error as FastifyError)
    : null
}
