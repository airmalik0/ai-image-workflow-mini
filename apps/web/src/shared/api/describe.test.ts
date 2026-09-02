import { describe, expect, it } from 'vitest'
import { describeApiError, describeJobError } from './describe'
import { ApiError } from './types'

describe('describeApiError', () => {
  it('разбирает ошибку по коду, а не по тексту сообщения', () => {
    const described = describeApiError(
      new ApiError('PROVIDER_SAFETY_BLOCKED', 'prompt rejected by safety filter', 422),
    )

    expect(described.code).toBe('PROVIDER_SAFETY_BLOCKED')
    expect(described.title).toBe('Провайдер отказал по правилам безопасности')
    expect(described.message).toBe('prompt rejected by safety filter')
    expect(described.hint).not.toBeNull()
  })

  it('незнакомый код не теряет сообщение', () => {
    const described = describeApiError(new ApiError('WAT_9000', 'что-то новое', 500))

    expect(described.code).toBe('WAT_9000')
    expect(described.message).toBe('что-то новое')
    expect(described.hint).toBeNull()
  })

  it('обычная ошибка тоже показывается, а не глотается', () => {
    expect(describeApiError(new Error('boom'))).toEqual(
      expect.objectContaining({ code: 'UNKNOWN', message: 'boom' }),
    )
  })
})

describe('describeJobError', () => {
  it('сохраняет признак повторяемости из контракта', () => {
    const described = describeJobError({
      code: 'PROVIDER_RATE_LIMITED',
      message: '429 Too Many Requests',
      retryable: true,
    })

    expect(described.retryable).toBe(true)
    expect(described.title).toBe('Провайдер ограничил частоту запросов')
  })
})
