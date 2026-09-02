import type { Preset } from '@workflow/contracts'
import { useQuery } from '@tanstack/react-query'
import { fetchPresets, presetsQueryKey } from '../api/preset-api'

export interface PresetsState {
  presets: Preset[]
  isLoading: boolean
  /** API может быть не поднят — интерфейс обязан это пережить и сказать об этом. */
  error: Error | null
}

/**
 * Список пресетов. Пресеты меняются редко, а UI на них ссылается из каждой ноды
 * генерации, поэтому запрос один на всё приложение — его кэширует TanStack Query.
 */
export const usePresets = (): PresetsState => {
  const query = useQuery({
    queryKey: presetsQueryKey,
    queryFn: ({ signal }) => fetchPresets(signal),
  })

  return {
    presets: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
  }
}

/** Пресет по идентификатору из ноды: он мог быть удалён, поэтому `null` — норма. */
export const findPreset = (presets: readonly Preset[], id: string | null): Preset | null =>
  id === null ? null : (presets.find((preset) => preset.id === id) ?? null)
