/**
 * Значения, зависящие от окружения. Базовый URL API берётся из VITE_API_URL,
 * а по умолчанию запросы идут на тот же origin — так работает и docker-сборка,
 * где статику и API отдаёт один хост.
 */
export const API_BASE_URL: string = import.meta.env['VITE_API_URL'] ?? '/api'

export const APP_NAME = 'Workflow'
