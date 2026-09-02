import { afterEach, describe, expect, it, vi } from 'vitest'
import { UPLOAD_FIELD_NAME, uploadImage } from './upload-file'

const okResponse = () =>
  new Response(JSON.stringify({ fileId: 'sha256-abc', url: '/api/files/sha256-abc' }), {
    headers: { 'Content-Type': 'application/json' },
  })

describe('загрузка изображения', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('уходит на POST /api/files формой, а не base64 в JSON', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(okResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

    const result = await uploadImage(file)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/files')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    const sent = (init?.body as FormData).get(UPLOAD_FIELD_NAME) as File
    expect(sent.name).toBe('photo.png')
    expect(sent.size).toBe(3)
    // тело формы собирает браузер: свой Content-Type сломал бы boundary
    expect(init?.headers).not.toHaveProperty('Content-Type')
    // в ноду возвращается идентификатор, а не содержимое файла
    expect(result).toEqual({ fileId: 'sha256-abc', url: '/api/files/sha256-abc' })
  })
})
