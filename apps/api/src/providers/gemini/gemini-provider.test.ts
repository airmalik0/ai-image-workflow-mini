import { InMemoryFileStorage } from '@workflow/core/testing'
import { ProviderError } from '@workflow/core'
import type { GenerateRequest } from '@workflow/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../http.js'
import { GeminiProvider } from './gemini-provider.js'

/**
 * Сеть не дёргается: `fetch` подменён, тела ответов взяты из живого спайка
 * `docs/research/gemini-api.md`. Проверяется разбор ответа и форма запроса —
 * то, что ломается молча и обнаруживается только на боевом ключе.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
const JPEG_BASE64 = Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x10])).toString('base64')

interface Call {
  url: string
  init: RequestInit
}

function stubFetch(responses: readonly Response[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const queue = [...responses]
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init })
    if (init.signal?.aborted === true) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    const response = queue.shift()
    if (!response) throw new Error('лишний запрос к провайдеру')
    return Promise.resolve(response)
  }
  return { fetch, calls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const IMAGE_RESPONSE = {
  candidates: [
    {
      content: {
        // болтливый текстовый парт: картинку нельзя искать по parts[0]
        parts: [
          { text: 'Here is your image: ' },
          { inlineData: { mimeType: 'image/jpeg', data: JPEG_BASE64 } },
        ],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: { promptTokenCount: 16, candidatesTokenCount: 1120, totalTokenCount: 1136 },
  modelVersion: 'gemini-3.1-flash-image',
  responseId: 'HN2XapOEKtL8nsEP27CN0Q0',
}

let storage: InMemoryFileStorage

beforeEach(() => {
  storage = new InMemoryFileStorage()
})

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    prompt: 'A red ceramic coffee mug on a wooden table',
    negativePrompt: null,
    references: [],
    model: null,
    aspectRatio: '16:9',
    ...overrides,
  }
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

describe('GeminiProvider.generate', () => {
  it('разбирает ответ: картинка найдена перебором parts, не по parts[0]', async () => {
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    const image = await provider.generate(request(), new AbortController().signal)

    expect(image.mimeType).toBe('image/jpeg')
    expect([...image.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(image.model).toBe('gemini-3.1-flash-image')
    expect(image.meta).toMatchObject({
      finishReason: 'STOP',
      responseId: 'HN2XapOEKtL8nsEP27CN0Q0',
    })
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    )
  })

  it('ключ уходит заголовком x-goog-api-key, а не в query — он не должен течь в логи прокси', () => {
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'secret-key', storage, fetch })

    return provider.generate(request(), new AbortController().signal).then(() => {
      const headers = new Headers(calls[0]?.init.headers)
      expect(headers.get('x-goog-api-key')).toBe('secret-key')
      expect(calls[0]?.url).not.toContain('secret-key')
    })
  })

  it('в запросе есть responseModalities: [IMAGE] — иначе модель припишет текстовый парт', async () => {
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await provider.generate(request(), new AbortController().signal)

    expect(body(calls[0] as Call)).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'A red ceramic coffee mug on a wooden table' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
      },
    })
  })

  it('референсы уходят партами inlineData перед текстом', async () => {
    const first = await storage.put(PNG, 'image/png')
    const second = await storage.put(new Uint8Array([0xff, 0xd8, 0xff, 0x01]), 'image/jpeg')
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await provider.generate(
      request({ references: [{ fileId: first }, { fileId: second }] }),
      new AbortController().signal,
    )

    const parts = (body(calls[0] as Call).contents as [{ parts: Record<string, unknown>[] }])[0]
      .parts
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({ inlineData: { mimeType: 'image/png' } })
    expect(parts[1]).toMatchObject({ inlineData: { mimeType: 'image/jpeg' } })
    expect(parts[2]).toHaveProperty('text')
  })

  it('HTTP 200 без картинки — ошибка, а не пустой результат', async () => {
    const { fetch } = stubFetch([
      json({ candidates: [{ content: {}, finishReason: 'NO_IMAGE', index: 0 }] }),
    ])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    const error = await provider
      .generate(request(), new AbortController().signal)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe('VALIDATION_FAILED')
    expect((error as ProviderError).retryable).toBe(false)
  })

  it('HTTP 200 с IMAGE_SAFETY — контентная блокировка', async () => {
    const { fetch } = stubFetch([
      json({
        candidates: [
          {
            content: {},
            finishReason: 'IMAGE_SAFETY',
            finishMessage: 'Unable to show the generated image.',
            index: 0,
          },
        ],
      }),
    ])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_SAFETY_BLOCKED',
      retryable: false,
    })
  })

  it('429 с RetryInfo — повторяемая ошибка с названной задержкой', async () => {
    const { fetch } = stubFetch([
      json(
        {
          error: {
            code: 429,
            message: 'You exceeded your current quota.',
            status: 'RESOURCE_EXHAUSTED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }],
          },
        },
        429,
      ),
    ])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
      retryAfterMs: 34_000,
    })
  })

  it('429 без details — кончились кредиты, повторять нельзя', async () => {
    const { fetch } = stubFetch([
      json(
        {
          error: {
            code: 429,
            message: 'Your prepayment credits are depleted.',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
        429,
      ),
    ])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: false,
    })
  })

  it('403 — ошибка конфигурации без повторов', async () => {
    const { fetch } = stubFetch([
      json({ error: { code: 403, message: "Method doesn't allow unregistered callers" } }, 403),
    ])
    const provider = new GeminiProvider({ apiKey: '', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    })
  })

  it('404 на несуществующей модели', async () => {
    const { fetch } = stubFetch([
      json({ error: { code: 404, message: 'models/x is not found', status: 'NOT_FOUND' } }, 404),
    ])
    const provider = new GeminiProvider({
      apiKey: 'k',
      storage,
      fetch,
      model: 'gemini-3-pro-image',
    })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })

  it('неподдерживаемый моделью аспект отсекается своей валидацией, без запроса', async () => {
    const { fetch, calls } = stubFetch([])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(
      provider.generate(
        request({ model: 'gemini-2.5-flash-image', aspectRatio: '1:4' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it('imageSize, который модель молча игнорирует, тоже отсекается заранее', async () => {
    const { fetch, calls } = stubFetch([])
    const provider = new GeminiProvider({
      apiKey: 'k',
      storage,
      fetch,
      model: 'gemini-2.5-flash-image',
      imageSize: '4K',
    })

    await expect(
      provider.generate(request({ aspectRatio: '1:1' }), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(calls).toHaveLength(0)
  })

  it('модель вне списка не отправляется в API', async () => {
    const { fetch, calls } = stubFetch([])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(
      provider.generate(request({ model: 'gemini-9-ultra-image' }), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(calls).toHaveLength(0)
  })

  it('отмена run’а прерывает запрос и не считается транзиентной', async () => {
    const { fetch } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })
    const controller = new AbortController()
    controller.abort()

    await expect(provider.generate(request(), controller.signal)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: false,
    })
  })
})

describe('GeminiProvider.edit', () => {
  it('исходник идёт первым партом, аспект не навязывается — он наследуется от входа', async () => {
    const source = await storage.put(PNG, 'image/png')
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await provider.edit({ ...request(), image: { fileId: source } }, new AbortController().signal)

    const payload = body(calls[0] as Call)
    const parts = (payload.contents as [{ parts: Record<string, unknown>[] }])[0].parts
    expect(parts[0]).toMatchObject({ inlineData: { mimeType: 'image/png' } })
    expect(parts.at(-1)).toHaveProperty('text')
    expect(payload.generationConfig).toEqual({ responseModalities: ['IMAGE'] })
  })

  it('несуществующий файл на входе — честная ошибка, а не пустая картинка', async () => {
    const { fetch } = stubFetch([])
    const provider = new GeminiProvider({ apiKey: 'k', storage, fetch })

    await expect(
      provider.edit(
        { ...request(), image: { fileId: 'нет-такого' } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })
})

describe('GeminiProvider.capabilities', () => {
  it('поля negative prompt у API нет — возможность объявлена честно', () => {
    const provider = new GeminiProvider({ apiKey: 'k', storage })

    expect(provider.capabilities.negativePrompt).toBe(false)
    expect(provider.capabilities.edit).toBe(true)
    expect(provider.capabilities.referenceImages).toBeGreaterThan(0)
    expect(provider.capabilities.aspectRatio).toContain('16:9')
  })

  it('список моделей описывает то, что реально проверено спайком', () => {
    const provider = new GeminiProvider({ apiKey: 'k', storage })

    expect(provider.defaultModel).toBe('gemini-3.1-flash-image')
    expect(provider.models.map((model) => model.id)).toContain('gemini-3-pro-image')
    expect(provider.models.every((model) => model.providerId === 'gemini')).toBe(true)
  })
})
