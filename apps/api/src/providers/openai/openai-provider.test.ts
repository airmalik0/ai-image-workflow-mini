import { ProviderError } from '@workflow/core'
import type { GenerateRequest } from '@workflow/core'
import { InMemoryFileStorage } from '@workflow/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../http.js'
import { OpenAiProvider } from './openai-provider.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
const PNG_BASE64 = Buffer.from(PNG).toString('base64')

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

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const IMAGE_RESPONSE = {
  created: 1_772_000_000,
  data: [{ b64_json: PNG_BASE64 }],
  usage: { total_tokens: 1590, input_tokens: 20, output_tokens: 1570 },
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
    aspectRatio: '1:1',
    ...overrides,
  }
}

describe('OpenAiProvider.generate', () => {
  it('text→image идёт JSON-ом на /v1/images/generations, ответ — base64 в data[0].b64_json', async () => {
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new OpenAiProvider({ apiKey: 'secret-key', storage, fetch })

    const image = await provider.generate(request(), new AbortController().signal)

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/generations')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer secret-key')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'gpt-image-2',
      prompt: 'A red ceramic coffee mug on a wooden table',
      n: 1,
      size: '1024x1024',
    })
    expect(image.model).toBe('gpt-image-2')
    expect([...image.bytes]).toEqual([...PNG])
    // mime API не называет — определяем по сигнатуре файла
    expect(image.mimeType).toBe('image/png')
    expect(image.meta).toMatchObject({ size: '1024x1024' })
  })

  it('пропорции переводятся в размер, который принимает модель', async () => {
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await provider.generate(request({ aspectRatio: '3:2' }), new AbortController().signal)

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ size: '1536x1024' })
  })

  it('неподдерживаемые пропорции отсекаются своей валидацией, без запроса', async () => {
    const { fetch, calls } = stubFetch([])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await expect(
      provider.generate(request({ aspectRatio: '21:9' }), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it('несколько референсов уходят одним запросом на /v1/images/edits повторяющимся полем image[]', async () => {
    const first = await storage.put(PNG, 'image/png')
    const second = await storage.put(new Uint8Array([0xff, 0xd8, 0xff, 0x07]), 'image/jpeg')
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await provider.generate(
      request({ references: [{ fileId: first }, { fileId: second }] }),
      new AbortController().signal,
    )

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/edits')
    const form = calls[0]?.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('size')).toBe('1024x1024')
  })

  it('пустой data в ответе — ошибка, а не пустая картинка', async () => {
    const { fetch } = stubFetch([json({ created: 1, data: [] })])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    const error = await provider
      .generate(request(), new AbortController().signal)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).retryable).toBe(false)
  })

  it('401 — ошибка конфигурации без повторов', async () => {
    const { fetch } = stubFetch([
      json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, 401),
    ])
    const provider = new OpenAiProvider({ apiKey: 'bad', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    })
  })

  it('модерация — контентная блокировка, а не «просто 400»', async () => {
    const { fetch } = stubFetch([
      json(
        {
          error: {
            message: 'Your request was rejected as a result of our safety system.',
            code: 'moderation_blocked',
          },
        },
        400,
      ),
    ])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_SAFETY_BLOCKED',
      retryable: false,
    })
  })

  it('429 с Retry-After — повторяемая ошибка с задержкой из заголовка', async () => {
    const { fetch } = stubFetch([
      json({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, 429, {
        'retry-after': '12',
      }),
    ])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
      retryAfterMs: 12_000,
    })
  })

  it('отмена run’а прерывает запрос и не считается транзиентной', async () => {
    const { fetch } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })
    const controller = new AbortController()
    controller.abort()

    await expect(provider.generate(request(), controller.signal)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: false,
    })
  })
})

describe('OpenAiProvider.edit', () => {
  it('исходник и референсы уходят одним multipart, исходник первым', async () => {
    const source = await storage.put(PNG, 'image/png')
    const reference = await storage.put(new Uint8Array([0xff, 0xd8, 0xff, 0x09]), 'image/jpeg')
    const { fetch, calls } = stubFetch([json(IMAGE_RESPONSE)])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await provider.edit(
      { ...request(), references: [{ fileId: reference }], image: { fileId: source } },
      new AbortController().signal,
    )

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/edits')
    const form = calls[0]?.init.body as FormData
    const images = form.getAll('image[]')
    expect(images).toHaveLength(2)
    expect((images[0] as File).type).toBe('image/png')
    expect((images[1] as File).type).toBe('image/jpeg')
    expect(form.get('prompt')).toBe('A red ceramic coffee mug on a wooden table')
  })

  it('несуществующий файл на входе — честная ошибка', async () => {
    const { fetch } = stubFetch([])
    const provider = new OpenAiProvider({ apiKey: 'k', storage, fetch })

    await expect(
      provider.edit(
        { ...request(), image: { fileId: 'нет-такого' } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })
})

describe('OpenAiProvider.capabilities', () => {
  it('поля negative prompt у API нет — возможность объявлена честно', () => {
    const provider = new OpenAiProvider({ apiKey: 'k', storage })

    expect(provider.capabilities.negativePrompt).toBe(false)
    expect(provider.capabilities.edit).toBe(true)
    expect(provider.capabilities.referenceImages).toBeGreaterThan(1)
    expect(provider.capabilities.aspectRatio).toContain('1:1')
    expect(provider.defaultModel).toBe('gpt-image-2')
  })
})
