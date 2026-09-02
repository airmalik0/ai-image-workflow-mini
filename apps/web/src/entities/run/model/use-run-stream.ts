import { runEventSchema } from '@workflow/contracts'
import type { RunEvent, RunState } from '@workflow/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { subscribeToEvents } from '@/shared/api'
import type { SseStatus } from '@/shared/api'
import { runEventsPath, runQueryKey } from '../api/run-api'
import { applyRunEvent } from '../lib/apply-run-event'

export interface RunStreamState {
  status: SseStatus
  /** Последнее пришедшее событие — для таймлайна и подсветки, без похода в кэш. */
  lastEvent: RunEvent | null
}

/**
 * Подписка на события запуска. `job.updated` не заставляет перезапрашивать run:
 * событие несёт готовый job, и в кэше меняется ровно он. Перезапрос на каждое
 * обновление статуса — это N+1 к серверу на ровном месте и мигание всего экрана.
 */
export const useRunStream = (runId: string | null): RunStreamState => {
  const client = useQueryClient()
  const [connection, setConnection] = useState<SseStatus>('closed')
  const [lastEvent, setLastEvent] = useState<RunEvent | null>(null)

  useEffect(() => {
    if (runId === null) return

    const key = runQueryKey(runId)
    const subscription = subscribeToEvents<RunEvent>({
      path: runEventsPath(runId),
      schema: runEventSchema,
      seqOf: (event) => event.seq,
      onStatus: setConnection,
      onEvent: (event) => {
        client.setQueryData<RunState>(key, (previous) => applyRunEvent(previous, event))
        setLastEvent(event)
      },
    })

    return () => subscription.close()
  }, [runId, client])

  // Без запуска подписки нет — состояние прошлой сюда не протекает.
  return { status: runId === null ? 'closed' : connection, lastEvent }
}
