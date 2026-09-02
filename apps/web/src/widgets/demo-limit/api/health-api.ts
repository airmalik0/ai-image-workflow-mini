import { healthResponseSchema } from '@workflow/contracts'
import type { HealthResponse } from '@workflow/contracts'
import { apiRequest } from '@/shared/api'

export const healthQueryKey = ['health'] as const

/** Состояние стенда: база, Redis, активный провайдер и остаток дневной квоты демо. */
export const fetchHealth = (signal?: AbortSignal): Promise<HealthResponse> =>
  apiRequest('/health', {
    schema: healthResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  })
