import { errorEnvelopeSchema } from '@workflow/contracts'
import type { ZodType } from 'zod'
import { API_BASE_URL } from '../config'
import { ApiError, CLIENT_ERROR_CODES } from './types'
import type { HttpMethod, QueryParams } from './types'

export interface RequestOptions<T> {
  /** Схема из `@workflow/contracts`. Ответ, который ей не подходит, до вызывающего не доедет. */
  schema: ZodType<T>
  method?: HttpMethod | undefined
  /** Тело в JSON. Одновременно с `form` не задаётся. */
  body?: unknown
  /**
   * Тело в `multipart/form-data`. Заголовок ставит браузер сам — вручную его писать нельзя,
   * иначе в нём не будет boundary и сервер не разберёт запрос.
   */
  form?: FormData | undefined
  query?: QueryParams | undefined
  signal?: AbortSignal | undefined
}

/** Абсолютный адрес ресурса API. Нужен и обычным запросам, и `EventSource`, и `<img>`. */
export const apiUrl = (path: string, query?: QueryParams): string => {
  const base = `${API_BASE_URL}${path}`
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value))
  }
  const suffix = search.toString()
  if (suffix === '') return base
  return base.includes('?') ? `${base}&${suffix}` : `${base}?${suffix}`
}

/** Адрес картинки по идентификатору файла: в графе и событиях ходит `fileId`, а не байты. */
export const fileUrl = (fileId: string): string => apiUrl(`/files/${encodeURIComponent(fileId)}`)

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (text === '') return undefined
  return JSON.parse(text) as unknown
}

/** Ответ с ошибкой: сначала пробуем разобрать конверт из контрактов, иначе — по статусу. */
const toApiError = async (response: Response): Promise<ApiError> => {
  const payload = await readJson(response).catch(() => undefined)
  const envelope = errorEnvelopeSchema.safeParse(payload)
  if (envelope.success) {
    const { code, message, details } = envelope.data.error
    return new ApiError(code, message, response.status, details)
  }
  return new ApiError(
    CLIENT_ERROR_CODES.http,
    `Запрос завершился с кодом ${response.status}`,
    response.status,
    payload,
  )
}

/**
 * Типобезопасный запрос к API. Тип результата задаёт схема контракта, а не
 * `as`-приведение: расхождение фронта и бэка обнаруживается на границе, в момент
 * разбора ответа, а не тремя экранами ниже — на попытке прочитать несуществующее поле.
 */
export const apiRequest = async <T>(path: string, options: RequestOptions<T>): Promise<T> => {
  const { schema, method = 'GET', body, form, query, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(apiUrl(path, query), {
      method,
      headers,
      ...(form !== undefined ? { body: form } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal !== undefined ? { signal } : {}),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Сеть недоступна'
    throw new ApiError(CLIENT_ERROR_CODES.network, message, 0, cause)
  }

  if (!response.ok) throw await toApiError(response)

  let payload: unknown
  try {
    payload = await readJson(response)
  } catch (cause) {
    throw new ApiError(CLIENT_ERROR_CODES.response, 'Ответ сервера не является JSON', 200, cause)
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(
      CLIENT_ERROR_CODES.response,
      'Ответ сервера не соответствует контракту',
      response.status,
      parsed.error.issues,
    )
  }
  return parsed.data
}
