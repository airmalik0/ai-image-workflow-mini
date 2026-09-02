import { expect, it } from 'vitest'
import { DomainError, ProviderError, isRetryable, toJobError } from './errors.js'

it('429 и 5xx считаются транзиентными', () => {
  expect(isRetryable(new ProviderError('PROVIDER_RATE_LIMITED', 'too many', true))).toBe(true)
})

it('safety-блокировка не ретраится', () => {
  expect(isRetryable(new ProviderError('PROVIDER_SAFETY_BLOCKED', 'blocked', false))).toBe(false)
})

it('неклассифицированная ошибка не считается транзиентной', () => {
  expect(isRetryable(new Error('boom'))).toBe(false)
  expect(isRetryable(new DomainError('VALIDATION_FAILED', 'нет входа'))).toBe(false)
})

it('ошибка провайдера превращается в JobError с сохранением кода и флага', () => {
  expect(toJobError(new ProviderError('PROVIDER_TIMEOUT', 'слишком долго', true))).toEqual({
    code: 'PROVIDER_TIMEOUT',
    message: 'слишком долго',
    retryable: true,
  })
})

it('чужая ошибка нормализуется в PROVIDER_UNAVAILABLE без права на ретрай', () => {
  expect(toJobError(new Error('socket hang up'))).toEqual({
    code: 'PROVIDER_UNAVAILABLE',
    message: 'socket hang up',
    retryable: false,
  })
})
