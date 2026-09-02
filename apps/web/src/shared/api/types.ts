/**
 * Ошибка обращения к API в одном виде — независимо от того, где именно сломалось:
 * сеть, HTTP-статус или разбор тела. Компонентам достаточно поймать `ApiError`
 * и показать `message`; `code` нужен там, где реакция зависит от причины.
 */
export class ApiError extends Error {
  readonly code: string
  /** HTTP-статус ответа; 0 — до сервера не дошли. */
  readonly status: number
  readonly details: unknown

  constructor(code: string, message: string, status = 0, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Коды, которых нет в контракте: сервер их не присылает, они рождаются на клиенте.
 * Конверт ошибок в `@workflow/contracts` принимает любую строку именно поэтому.
 */
export const CLIENT_ERROR_CODES = {
  /** Запрос не дошёл до сервера: обрыв сети, CORS, отмена. */
  network: 'NETWORK_ERROR',
  /** Ответ пришёл, но не подходит под схему контракта. */
  response: 'RESPONSE_INVALID',
  /** Ответ с ошибкой, у которого тело не в формате конверта ошибок. */
  http: 'HTTP_ERROR',
} as const

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QueryParams = Record<string, string | number | boolean | undefined>
