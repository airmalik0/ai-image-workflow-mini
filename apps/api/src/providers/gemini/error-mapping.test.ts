import { describe, expect, it } from 'vitest'
import { mapGeminiHttpError, mapGeminiMissingImage, parseRetryDelayMs } from './error-mapping.js'

/**
 * Тела ответов — дословно из живого спайка `docs/research/gemini-api.md` (§8).
 * Сеть здесь не дёргается: маппер обязан быть проверяемым без квоты и без ключа.
 */

const INVALID_KEY = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
      },
    ],
  },
}

const NO_CALLER = {
  error: {
    code: 403,
    message:
      "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
    status: 'PERMISSION_DENIED',
  },
}

const MODEL_NOT_FOUND = {
  error: {
    code: 404,
    message:
      'models/gemini-9-ultra-image is not found for API version v1beta, or is not supported for generateContent.',
    status: 'NOT_FOUND',
  },
}

const BAD_ASPECT_RATIO = {
  error: {
    code: 400,
    message: 'Aspect ratio 1:4 is not supported for this model',
    status: 'INVALID_ARGUMENT',
  },
}

const UNKNOWN_FIELD = {
  error: {
    code: 400,
    message:
      'Invalid JSON payload received. Unknown name "negativePrompt" at \'generation_config\': Cannot find field.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{ description: 'Invalid JSON payload received.' }],
      },
    ],
  },
}

const RATE_LIMITED = {
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 500, model: gemini-2.5-flash-preview-image\nPlease retry in 34.286670503s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaId: 'GenerateRequestsPerMinutePerProjectPerModel',
            quotaValue: '500',
            quotaDimensions: { model: 'gemini-2.5-flash-preview-image', location: 'global' },
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
    ],
  },
}

const CREDITS_DEPLETED = {
  error: {
    code: 429,
    message:
      'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.',
    status: 'RESOURCE_EXHAUSTED',
  },
}

const UNAVAILABLE = {
  error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' },
}

describe('mapGeminiHttpError', () => {
  it('неверный ключ — ошибка конфигурации, повторять бессмысленно', () => {
    const error = mapGeminiHttpError(400, INVALID_KEY)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('ключ')
  })

  it('403 без идентификации вызывающего — тоже конфигурация', () => {
    const error = mapGeminiHttpError(403, NO_CALLER)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(false)
  })

  it('404 на несуществующей модели — ошибка параметров запроса', () => {
    const error = mapGeminiHttpError(404, MODEL_NOT_FOUND)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('gemini-9-ultra-image')
  })

  it('400 на неподдерживаемом аспекте — ошибка параметров', () => {
    const error = mapGeminiHttpError(400, BAD_ASPECT_RATIO)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('Aspect ratio 1:4 is not supported')
  })

  it('400 на неизвестном поле — ошибка параметров, не транзиентная', () => {
    const error = mapGeminiHttpError(400, UNKNOWN_FIELD)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
  })

  it('429 с RetryInfo — квота RPM: повторять через названную задержку', () => {
    const error = mapGeminiHttpError(429, RATE_LIMITED)

    expect(error.code).toBe('PROVIDER_RATE_LIMITED')
    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBe(34_000)
  })

  it('429 без details — кончились деньги: повтор бесполезен', () => {
    const error = mapGeminiHttpError(429, CREDITS_DEPLETED)

    expect(error.code).toBe('PROVIDER_RATE_LIMITED')
    expect(error.retryable).toBe(false)
    expect(error.retryAfterMs).toBeNull()
  })

  it('503 — транзиентная недоступность сервиса', () => {
    const error = mapGeminiHttpError(503, UNAVAILABLE)

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(true)
  })

  it('500 без разбираемого тела — транзиентная, но текст сохраняется', () => {
    const error = mapGeminiHttpError(500, '<html>502 Bad Gateway</html>')

    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('502 Bad Gateway')
  })

  it('неизвестный 4xx не считается транзиентным', () => {
    const error = mapGeminiHttpError(418, { error: { code: 418, message: 'teapot' } })

    expect(error.retryable).toBe(false)
  })
})

describe('parseRetryDelayMs', () => {
  it('берёт задержку из RetryInfo', () => {
    expect(parseRetryDelayMs(RATE_LIMITED)).toBe(34_000)
  })

  it('дробные секунды из RetryInfo округляются вверх до миллисекунд', () => {
    const body = {
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '4.5s' }],
      },
    }

    expect(parseRetryDelayMs(body)).toBe(4500)
  })

  it('если RetryInfo нет, задержка вытаскивается из текста сообщения', () => {
    const body = {
      error: {
        code: 429,
        message: 'You exceeded your current quota.\nPlease retry in 34.286670503s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] }],
      },
    }

    expect(parseRetryDelayMs(body)).toBe(34_287)
  })

  it('без details и без текста задержки — null', () => {
    expect(parseRetryDelayMs(CREDITS_DEPLETED)).toBeNull()
  })
})

describe('mapGeminiMissingImage — HTTP 200 без картинки', () => {
  // Отказ модели приходит успешным HTTP: пять сценариев из шестнадцати в §8 отчёта.
  it.each([
    ['IMAGE_SAFETY', 'PROVIDER_SAFETY_BLOCKED'],
    ['IMAGE_PROHIBITED_CONTENT', 'PROVIDER_SAFETY_BLOCKED'],
    ['IMAGE_RECITATION', 'PROVIDER_SAFETY_BLOCKED'],
    ['PROHIBITED_CONTENT', 'PROVIDER_SAFETY_BLOCKED'],
    ['SAFETY', 'PROVIDER_SAFETY_BLOCKED'],
    ['NO_IMAGE', 'VALIDATION_FAILED'],
    ['IMAGE_OTHER', 'VALIDATION_FAILED'],
    ['STOP', 'VALIDATION_FAILED'],
    ['MAX_TOKENS', 'VALIDATION_FAILED'],
  ])('finishReason %s → %s, без повтора', (finishReason, code) => {
    const error = mapGeminiMissingImage({ content: {}, finishReason, index: 0 })

    expect(error.code).toBe(code)
    expect(error.retryable).toBe(false)
    expect(error.message).toContain(finishReason)
  })

  it('finishMessage от 3-pro попадает в текст ошибки — его показывают пользователю', () => {
    const error = mapGeminiMissingImage({
      content: {},
      finishReason: 'IMAGE_SAFETY',
      finishMessage:
        "Unable to show the generated image. The image was filtered out because it violated Google's Generative AI Prohibited Use policy.",
      index: 0,
    })

    expect(error.message).toContain('Prohibited Use policy')
  })

  it('кандидата нет вовсе — ошибка, а не тихий успех', () => {
    const error = mapGeminiMissingImage(undefined)

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.retryable).toBe(false)
  })
})

/*
 * Текст из чужого сервиса доезжает до браузера через job.error.message и SSE.
 * Длину ограничиваем в одном месте — на входе: карточка ноды не должна
 * превращаться в простыню, а размер события в потоке не должен зависеть
 * от многословности апстрима.
 */
it('обрезает длинный текст ошибки апстрима, а не только сырую строку тела', () => {
  const error = mapGeminiHttpError(400, { error: { message: 'ы'.repeat(900) } })

  // 300 символов апстрима плюс наш собственный префикс — но не девятьсот
  expect(error.message.length).toBeLessThan(400)
  expect(error.message.endsWith('…')).toBe(true)
})
