import { fileUploadResponseSchema, modelsResponseSchema } from '@workflow/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, apiUrl } from './http'
import { ApiError, CLIENT_ERROR_CODES } from './types'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const mockFetch = (response: Response) => {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const models = [
  { id: 'gpt-image-2', providerId: 'openai', label: 'GPT Image 2', supportsEdit: true },
]

/** Ошибка запроса. Успешный ответ там, где ждём падения, — это провал теста, а не «ну ладно». */
const failureOf = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('запрос должен был упасть')
}

describe('http-клиент', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('разбирает успешный ответ по схеме контракта', async () => {
    const fetchMock = mockFetch(jsonResponse({ models }))

    const result = await apiRequest('/models', { schema: modelsResponseSchema })

    expect(result.models[0]?.providerId).toBe('openai')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('валит ответ, не подходящий под схему', async () => {
    // supportsEdit пришёл строкой — на бэке уехал контракт, и молча это пропускать нельзя
    mockFetch(jsonResponse({ models: [{ ...models[0], supportsEdit: 'yes' }] }))

    const failure = await failureOf(apiRequest('/models', { schema: modelsResponseSchema }))

    expect(failure.code).toBe(CLIENT_ERROR_CODES.response)
  })

  it('поднимает конверт ошибки сервера как есть', async () => {
    mockFetch(jsonResponse({ error: { code: 'GRAPH_INVALID', message: 'В графе есть цикл' } }, 422))

    const failure = await failureOf(
      apiRequest('/runs', { schema: modelsResponseSchema, method: 'POST' }),
    )

    expect(failure.code).toBe('GRAPH_INVALID')
    expect(failure.message).toBe('В графе есть цикл')
    expect(failure.status).toBe(422)
  })

  it('обрыв сети превращает в ApiError, а не в голый TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    const failure = await failureOf(apiRequest('/models', { schema: modelsResponseSchema }))

    expect(failure.code).toBe(CLIENT_ERROR_CODES.network)
  })

  it('multipart уходит без ручного Content-Type: boundary ставит браузер', async () => {
    const fetchMock = mockFetch(jsonResponse({ fileId: 'f1', url: '/api/files/f1' }))
    const form = new FormData()
    form.append('file', new Blob(['x']), 'photo.png')

    await apiRequest('/files', { schema: fileUploadResponseSchema, method: 'POST', form })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.body).toBe(form)
    expect(init?.headers).not.toHaveProperty('Content-Type')
  })

  it('собирает адрес с query-параметрами', () => {
    expect(apiUrl('/runs/7/events', { lastEventId: 3 })).toBe('/api/runs/7/events?lastEventId=3')
    expect(apiUrl('/models', { missing: undefined })).toBe('/api/models')
  })
})
