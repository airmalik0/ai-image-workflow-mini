import { useCallback } from 'react'
import { useRunState } from '@/entities/run'
import { useWorkflowStore } from '@/entities/workflow'
import { useRetryJob } from '@/features/retry-job'
import { RunTimelineView } from './run-timeline-view'

export interface RunTimelineProps {
  /** `null` — запусков ещё не было; таймлайн показывает, что здесь появится. */
  runId: string | null
  defaultOpen?: boolean | undefined
}

/**
 * Таймлайн в редакторе. Состояние берётся из кэша TanStack Query — того же, что
 * точечно правит подписка на события: второй копии статусов на фронте нет.
 *
 * Выделение синхронизировано с холстом через `selected` на самих нодах —
 * единственный источник правды о выборе в React Flow.
 *
 * Повтор упавшей ноды доступен и отсюда: разбор ошибок с кодами лежит именно
 * здесь, и заставлять искать ту же ноду на холсте ради кнопки незачем.
 */
export const RunTimeline = ({ runId, defaultOpen }: RunTimelineProps) => {
  const { state, isLoading, error } = useRunState(runId)
  const nodes = useWorkflowStore((store) => store.nodes)
  const onNodesChange = useWorkflowStore((store) => store.onNodesChange)
  const retry = useRetryJob()

  const selected = nodes.filter((node) => node.selected === true)
  const selectedNodeId = selected.length === 1 ? (selected[0]?.id ?? null) : null

  const selectNode = useCallback(
    (nodeId: string) => {
      onNodesChange(
        useWorkflowStore.getState().nodes.map((node) => ({
          id: node.id,
          type: 'select' as const,
          selected: node.id === nodeId,
        })),
      )
    },
    [onNodesChange],
  )

  return (
    <RunTimelineView
      state={state}
      isLoading={isLoading}
      error={error}
      selectedNodeId={selectedNodeId}
      onSelectNode={selectNode}
      defaultOpen={defaultOpen}
      onRetry={retry.retry}
      retryingNodeId={retry.pendingNodeId}
    />
  )
}
