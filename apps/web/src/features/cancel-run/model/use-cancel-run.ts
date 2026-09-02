import type { RunState } from '@workflow/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { cancelRun, runQueryKey, useActiveRun } from '@/entities/run'

export interface CancelRunState {
  /** Отменить текущий запуск; `null` — запуска нет. */
  cancel: (() => void) | null
  isCancelling: boolean
  error: unknown
}

/**
 * Отмена запуска. Ответ приходит полным состоянием run'а, и он же кладётся в кэш:
 * ждать события об отмене, чтобы перерисовать интерфейс, незачем — сервер уже
 * сказал, чем всё кончилось. Повторная отмена завершённого запуска идемпотентна,
 * поэтому гонка «нажал, пока последняя нода дорабатывала» ничего не ломает.
 */
export const useCancelRun = (): CancelRunState => {
  const client = useQueryClient()
  const runId = useActiveRun((state) => state.runId)

  const mutation = useMutation({
    mutationFn: (id: string) => cancelRun(id),
    onSuccess: (state: RunState) => {
      client.setQueryData(runQueryKey(state.run.id), state)
    },
  })

  const mutate = mutation.mutate
  const cancel = useCallback(() => {
    if (runId === null) return
    mutate(runId)
  }, [mutate, runId])

  return {
    cancel: runId === null ? null : cancel,
    isCancelling: mutation.isPending,
    error: mutation.error,
  }
}
