import { ApiError, CLIENT_ERROR_CODES } from './types'

/**
 * Ошибка, приведённая к виду «заголовок — текст — код». Заголовок выбирается по
 * машиночитаемому `code`, а не по тексту сообщения: текст приходит с сервера и
 * меняется, код — часть контракта.
 */
export interface ErrorDescription {
  code: string
  title: string
  /** Текст от сервера или провайдера. Показывается как есть — он и есть суть отказа. */
  message: string
  /** Что делать дальше; `null` — подсказки нет, врать не будем. */
  hint: string | null
  /** Имеет ли смысл повторить. `null` — неизвестно. */
  retryable: boolean | null
}

const TITLES: Record<string, string> = {
  [CLIENT_ERROR_CODES.network]: 'Нет связи с API',
  [CLIENT_ERROR_CODES.response]: 'Ответ сервера не соответствует контракту',
  [CLIENT_ERROR_CODES.http]: 'Сервер ответил ошибкой',
  GRAPH_INVALID: 'Граф не прошёл проверку на сервере',
  RUN_NOT_FOUND: 'Запуск не найден',
  VALIDATION_FAILED: 'Запрос не прошёл проверку',
  FILE_NOT_FOUND: 'Файл не найден',
  PROVIDER_RATE_LIMITED: 'Провайдер ограничил частоту запросов',
  PROVIDER_SAFETY_BLOCKED: 'Провайдер отказал по правилам безопасности',
  PROVIDER_TIMEOUT: 'Провайдер не ответил вовремя',
  PROVIDER_UNAVAILABLE: 'Провайдер недоступен',
}

const HINTS: Record<string, string> = {
  [CLIENT_ERROR_CODES.network]:
    'Проверьте, поднят ли API: dev-сервер проксирует /api на localhost:3000',
  [CLIENT_ERROR_CODES.response]: 'Версии фронта и API разошлись — нужен пересбор',
  [CLIENT_ERROR_CODES.http]: 'Ответ не в формате конверта ошибок — смотрите логи API',
  GRAPH_INVALID: 'Исправьте отмеченные ноды и связи и запустите снова',
  RUN_NOT_FOUND: 'Запуск удалён или сервер перезапустили — соберите граф заново',
  PROVIDER_RATE_LIMITED: 'Повторить через несколько секунд — ключ упёрся в лимит',
  PROVIDER_SAFETY_BLOCKED: 'Повтор не поможет: нужно изменить формулировку промпта',
  PROVIDER_TIMEOUT: 'Повторить: у провайдера бывают долгие ответы',
  PROVIDER_UNAVAILABLE: 'Повторить позже или выбрать другую модель',
}

const UNKNOWN_CODE = 'UNKNOWN'

const describe = (code: string, message: string, retryable: boolean | null): ErrorDescription => ({
  code,
  title: TITLES[code] ?? 'Ошибка',
  message,
  hint: HINTS[code] ?? null,
  retryable,
})

/** Ошибка обращения к API. Всё, что не `ApiError`, тоже показывается, а не глотается. */
export const describeApiError = (error: unknown): ErrorDescription => {
  if (error instanceof ApiError) return describe(error.code, error.message, null)
  if (error instanceof Error) {
    return { ...describe(UNKNOWN_CODE, error.message, null), title: 'Непредвиденная ошибка' }
  }
  return { ...describe(UNKNOWN_CODE, String(error), null), title: 'Непредвиденная ошибка' }
}

/** Ошибка job'а: текст и код приходят от провайдера через контракт, здесь только оформление. */
export const describeJobError = (error: {
  code: string
  message: string
  retryable: boolean
}): ErrorDescription => describe(error.code, error.message, error.retryable)
