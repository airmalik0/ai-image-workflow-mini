import type { RunState } from '@workflow/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { retryRunNode, runQueryKey, useActiveRun } from '@/entities/run'

export interface RetryJobState {
  /** Повторить ноду упавшего запуска; `null` — запуска нет. */
  retry: ((nodeId: string) => void) | null
  /** Нода, чей повтор сейчас в полёте. */
  pendingNodeId: string | null
  /** Отказ на запрос повтора вместе с нодой, которой он касается. */
  error: { nodeId: string; error: unknown } | null
}

/**
 * Повтор упавшей ноды. Сервер сбрасывает её и её потомков и запускает планировщик
 * заново; успешные предки не пересчитываются — их выходы уже сохранены, и платить
 * провайдеру за них второй раз не за что.
 *
 * Ответ — полное состояние запуска, поэтому кэш обновляется сразу, а не по приходу
 * первого события: между ответом и событием нода иначе висела бы в старой ошибке.
 *
 * Отказ «нода ещё выполняется» — нормальный ответ сервера, а не сбой клиента:
 * он показывается на самой ноде и остаётся до следующей попытки.
 */
export const useRetryJob = (): RetryJobState => {
  const client = useQueryClient()
  const runId = useActiveRun((state) => state.runId)

  const mutation = useMutation({
    mutationFn: ({ runId: id, nodeId }: { runId: string; nodeId: string }) =>
      retryRunNode(id, nodeId),
    onSuccess: (state: RunState) => {
      client.setQueryData(runQueryKey(state.run.id), state)
    },
  })

  // Ссылка на колбэк стабильна: она уезжает в контекст карточек нод, и новая
  // ссылка на каждый рендер холста перерисовывала бы все ноды разом.
  const mutate = mutation.mutate
  const retry = useCallback(
    (nodeId: string) => {
      if (runId === null) return
      mutate({ runId, nodeId })
    },
    [mutate, runId],
  )

  const pending = mutation.isPending ? (mutation.variables?.nodeId ?? null) : null
  const failed =
    mutation.error === null || mutation.variables === undefined
      ? null
      : { nodeId: mutation.variables.nodeId, error: mutation.error }

  return {
    retry: runId === null ? null : retry,
    pendingNodeId: pending,
    error: failed,
  }
}
