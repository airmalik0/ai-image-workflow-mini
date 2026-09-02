import { describe, expect, it } from 'vitest'
import { mapOpenAiHttpError } from './error-mapping.js'

/** Конверт ошибок OpenAI един: `{ error: { message, type, code, param } }` (см. docs/research/openai-images.md). */

const INVALID_KEY = {
  error: {
    message: 'Incorrect API key provided: sk-***. You can find your API key at …',
    type: 'invalid_request_error',
    param: null,
    code: 'invalid_api_key',
  },
}

const NO_ACCESS = {
  error: {
    message: 'Your organization must be verified to use the model `gpt-image-2`.',
    type: 'invalid_request_error',
    param: null,
    code: 'model_not_available',
  },
}

const MODEL_NOT_FOUND = {
  error: {
    message: 'The model `gpt-image-9` does not exist or you do not have access to it.',
    type: 'invalid_request_error',
    param: null,
    code: 'model_not_found',
  },
}

const BAD_SIZE = {
  error: {
    message: "Invalid size 'banana'. Expected WIDTHxHEIGHT, for example '1824x1024'.",
    type: 'image_generation_user_error',
    param: 'size',
    code: 'invalid_value',
  },
}

const MODERATION = {
  error: {
    message:
      'Your request was rejected as a result of our safety system. Your prompt may contain text that is not allowed by our safety system.',
    type: 'image_generation_user_error',
    param: null,
    code: 'moderation_blocked',
  },
}

const RATE_LIMITED = {
  error: {
    message:
      'Rate limit reached for gpt-image-2 in organization org-x on images per min. Limit: 5/min. Please try again in 12s.',
    type: 'requests',
    param: null,
    code: 'rate_limit_exceeded',
  },
}

const NO_QUOTA = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
}

const SERVER_ERROR = {
  error: {
    message: 'The server had an error while processing your request. Sorry about that!',
    type: 'server_error',
    param: null,
    code: null,
  },
}

describe('mapOpenAiHttpError', () => {
  it('401 с invalid_api_key — ошибка конфигурации, повторять бессмысленно', () => {
    const error = mapOpenAiHttpError(401, INVALID_KEY, null)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('Incorrect API key')
  })

  it('403 без доступа к модели — тоже конфигурация', () => {
    const error = mapOpenAiHttpError(403, NO_ACCESS, null)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(false)
  })

  it('404 на несуществующей модели — ошибка параметров', () => {
    const error = mapOpenAiHttpError(404, MODEL_NOT_FOUND, null)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
  })

  it('400 на неверном размере — ошибка параметров', () => {
    const error = mapOpenAiHttpError(400, BAD_SIZE, null)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('Expected WIDTHxHEIGHT')
  })

  it('модерация — отдельный код, а не «просто 400»', () => {
    const error = mapOpenAiHttpError(400, MODERATION, null)

    expect(error.code).toBe('PROVIDER_SAFETY_BLOCKED')
    expect(error.retryable).toBe(false)
  })

  it('429 rate limit — транзиентная, задержка из заголовка Retry-After', () => {
    const error = mapOpenAiHttpError(429, RATE_LIMITED, '12')

    expect(error.code).toBe('PROVIDER_RATE_LIMITED')
    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBe(12_000)
  })

  it('429 без Retry-After остаётся транзиентной, но без названной задержки', () => {
    const error = mapOpenAiHttpError(429, RATE_LIMITED, null)

    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBeNull()
  })

  it('429 insufficient_quota — кончились деньги, повтор бесполезен', () => {
    const error = mapOpenAiHttpError(429, NO_QUOTA, null)

    expect(error.code).toBe('PROVIDER_RATE_LIMITED')
    expect(error.retryable).toBe(false)
  })

  it('500 — транзиентная', () => {
    const error = mapOpenAiHttpError(500, SERVER_ERROR, null)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(true)
  })

  it('503 без разбираемого тела — транзиентная, текст сохраняется', () => {
    const error = mapOpenAiHttpError(503, 'upstream connect error', null)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('upstream connect error')
  })

  it('Retry-After в формате HTTP-даты не ломает разбор', () => {
    const error = mapOpenAiHttpError(429, RATE_LIMITED, 'Wed, 21 Oct 2026 07:28:00 GMT')

    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBeNull()
  })
})
