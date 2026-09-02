import { validationResultSchema } from '@workflow/contracts'
import type { ValidationIssue, WorkflowGraph } from '@workflow/contracts'
import { validateGraph } from '@workflow/core'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { startRun, useActiveRun } from '@/entities/run'
import { useWorkflowStore } from '@/entities/workflow'
import { ApiError } from '@/shared/api'

export interface RunWorkflowState {
  /** Проверить граф и, если он валиден, запустить. */
  start: () => void
  isStarting: boolean
  /**
   * Причины, по которым запуск не состоялся. Локальные ошибки и ошибки, названные
   * сервером, лежат вместе: для пользователя это один и тот же вопрос — что чинить.
   */
  issues: ValidationIssue[]
  /** Ошибка запроса, не связанная с графом: сеть, 500, неверный ответ. */
  error: unknown
  /** Скрыть разбор проблем: следующий запуск наполнит его заново. */
  dismiss: () => void
}

/**
 * Выделяет на холсте виновников отказа. Идентификаторы приходят либо из локальной
 * проверки, либо прямо из ответа сервера (`error.details`) — искать ноду по тексту
 * сообщения пользователь не обязан.
 */
const highlight = (issues: readonly ValidationIssue[]): void => {
  const guilty = new Set(
    issues.flatMap((issue) => (issue.nodeId === undefined ? [] : [issue.nodeId])),
  )
  if (guilty.size === 0) return

  const { nodes, onNodesChange } = useWorkflowStore.getState()
  onNodesChange(
    nodes.map((node) => ({ id: node.id, type: 'select' as const, selected: guilty.has(node.id) })),
  )
}

/** Проблемы графа из ответа сервера. `GRAPH_INVALID` несёт их в `details`. */
const serverIssues = (error: unknown): ValidationIssue[] => {
  if (!(error instanceof ApiError) || error.code !== 'GRAPH_INVALID') return []
  const parsed = validationResultSchema.safeParse(error.details)
  return parsed.success ? parsed.data.errors : []
}

/**
 * Запуск графа с холста.
 *
 * Граф проверяется до запроса — тем же валидатором из ядра, которым его проверит
 * сервер. Смысл не в экономии запроса: невалидный граф не оставляет следов
 * в истории запусков, а причина отказа показывается мгновенно и на самой ноде.
 * Серверную проверку это не заменяет — сервер валидирует заново, и его отказ
 * разбирается здесь же.
 */
export const useRunWorkflow = (): RunWorkflowState => {
  const setRunId = useActiveRun((state) => state.setRunId)
  const [issues, setIssues] = useState<ValidationIssue[]>([])

  const mutation = useMutation({
    mutationFn: (graph: WorkflowGraph) => startRun(graph),
    onSuccess: ({ runId }) => {
      // с этого момента таймлайн, статусы нод и поток событий смотрят на новый запуск
      setRunId(runId)
    },
    onError: (error) => {
      const rejected = serverIssues(error)
      setIssues(rejected)
      highlight(rejected)
    },
  })

  const start = useCallback(() => {
    const graph = useWorkflowStore.getState().graph()
    const { errors } = validateGraph(graph)
    setIssues(errors)

    if (errors.length > 0) {
      highlight(errors)
      return
    }
    mutation.mutate(graph)
  }, [mutation])

  const dismiss = useCallback(() => setIssues([]), [])

  return {
    start,
    isStarting: mutation.isPending,
    issues,
    // проблемы графа показываются списком; здесь остаётся всё остальное
    error: serverIssues(mutation.error).length > 0 ? null : mutation.error,
    dismiss,
  }
}
