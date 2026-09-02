import type { RunState } from '@workflow/contracts'
import { useQuery } from '@tanstack/react-query'
import { fetchRunState, runQueryKey } from '../api/run-api'

export interface RunStateQuery {
  state: RunState | null
  isLoading: boolean
  error: Error | null
}

/**
 * Состояние запуска из кэша TanStack Query. Тот же ключ точечно правит `useRunStream`,
 * поэтому подписка на события и этот хук показывают одно и то же состояние, а не
 * два расходящихся: запрос нужен один раз — за графом и историей, дальше поток.
 */
export const useRunState = (runId: string | null): RunStateQuery => {
  const query = useQuery({
    queryKey: runQueryKey(runId ?? ''),
    queryFn: ({ signal }) => fetchRunState(runId ?? '', signal),
    enabled: runId !== null,
  })

  return {
    state: query.data ?? null,
    // `isPending` у выключенного запроса тоже true — без запуска грузить нечего.
    isLoading: runId !== null && query.isPending,
    error: query.error,
  }
}
