import { modelsResponseSchema } from '@workflow/contracts'
import type { ModelDescriptor } from '@workflow/contracts'
import { apiRequest } from '@/shared/api'

export const modelsQueryKey = ['models'] as const

/** Модели активных провайдеров. Список зависит от того, какие ключи заданы на сервере. */
export const fetchModels = async (signal?: AbortSignal): Promise<ModelDescriptor[]> => {
  const response = await apiRequest('/models', {
    schema: modelsResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  })
  return response.models
}
