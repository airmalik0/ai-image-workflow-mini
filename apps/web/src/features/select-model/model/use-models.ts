import type { ModelDescriptor } from '@workflow/contracts'
import { useQuery } from '@tanstack/react-query'
import { fetchModels, modelsQueryKey } from '../api/models-api'

export interface ModelsState {
  models: ModelDescriptor[]
  isLoading: boolean
  error: Error | null
}

export const useModels = (): ModelsState => {
  const query = useQuery({
    queryKey: modelsQueryKey,
    queryFn: ({ signal }) => fetchModels(signal),
  })

  return {
    models: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
  }
}

/**
 * Выбранная моделью дескриптор. `null` — модель не выбрана (провайдер возьмёт свою)
 * или выбранной больше нет в списке: ключ провайдера убрали, а граф остался.
 */
export const findModel = (
  models: readonly ModelDescriptor[],
  id: string | null,
): ModelDescriptor | null =>
  id === null ? null : (models.find((model) => model.id === id) ?? null)
