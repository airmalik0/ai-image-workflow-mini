import { createRunResponseSchema, runStateSchema } from '@workflow/contracts'
import type { CreateRunResponse, RunState, WorkflowGraph } from '@workflow/contracts'
import { apiRequest } from '@/shared/api'

/** Ключ кэша состояния запуска. Тот же ключ точечно правит подписка на события. */
export const runQueryKey = (runId: string) => ['run', runId] as const

/** Polling-фолбэк из спеки: полное состояние запуска одним запросом. */
export const fetchRunState = (runId: string, signal?: AbortSignal): Promise<RunState> =>
  apiRequest(`/runs/${runId}`, {
    schema: runStateSchema,
    ...(signal === undefined ? {} : { signal }),
  })

export const runEventsPath = (runId: string): string => `/runs/${runId}/events`

/**
 * Запуск графа. На сервер уходит сам граф, а не идентификатор сохранённого
 * workflow: редактор запускает то, что сейчас на холсте, — в том числе граф,
 * который нигде не сохранён.
 */
export const startRun = (graph: WorkflowGraph, signal?: AbortSignal): Promise<CreateRunResponse> =>
  apiRequest('/runs', {
    schema: createRunResponseSchema,
    method: 'POST',
    body: { graph },
    ...(signal === undefined ? {} : { signal }),
  })

/**
 * Отмена и повтор возвращают полное состояние запуска, а не пустой ответ.
 * Поэтому клиенту не нужно ни перезапрашивать run, ни ждать события: он кладёт
 * ответ в тот же кэш, и интерфейс меняется в момент ответа сервера.
 */
export const cancelRun = (runId: string): Promise<RunState> =>
  apiRequest(`/runs/${encodeURIComponent(runId)}/cancel`, {
    schema: runStateSchema,
    method: 'POST',
  })

export const retryRunNode = (runId: string, nodeId: string): Promise<RunState> =>
  apiRequest(`/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/retry`, {
    schema: runStateSchema,
    method: 'POST',
  })
