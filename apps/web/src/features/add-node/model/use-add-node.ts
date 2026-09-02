import { nodeKinds } from '@workflow/contracts'
import type { NodeKind } from '@workflow/contracts'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/entities/workflow'
import type { WorkflowFlowNode } from '@/entities/workflow'

/** Свой MIME, а не `text/plain`: перетаскивание ноды не должно путаться со сбросом текста. */
export const NODE_DRAG_MIME = 'application/x-workflow-node'

/** Половина карточки ноды: курсор должен оказаться в её середине, а не в углу. */
const NODE_GRAB_OFFSET = { x: 124, y: 48 }

/** Сдвиг при добавлении по клику, чтобы вторая нода не легла ровно на первую. */
const CASCADE_STEP = 28
const CASCADE_RADIUS = 24

export const isNodeKind = (value: string): value is NodeKind =>
  (nodeKinds as readonly string[]).includes(value)

/** Читает тип ноды из события перетаскивания; `null` — если тащили что-то чужое. */
export const readDraggedKind = (event: { dataTransfer: DataTransfer | null }): NodeKind | null => {
  const value = event.dataTransfer?.getData(NODE_DRAG_MIME) ?? ''
  return isNodeKind(value) ? value : null
}

export const startNodeDrag = (event: { dataTransfer: DataTransfer }, kind: NodeKind): void => {
  event.dataTransfer.setData(NODE_DRAG_MIME, kind)
  event.dataTransfer.effectAllowed = 'move'
}

const isTaken = (nodes: WorkflowFlowNode[], x: number, y: number): boolean =>
  nodes.some(
    (node) =>
      Math.abs(node.position.x - x) < CASCADE_RADIUS &&
      Math.abs(node.position.y - y) < CASCADE_RADIUS,
  )

/**
 * Добавление ноды с канваса: по клику в палитре — в центр видимой области,
 * перетаскиванием — под курсор. Параметры по умолчанию берёт стор из `NODE_SPECS`.
 */
export const useAddNode = () => {
  const { screenToFlowPosition } = useReactFlow()
  const store = useStoreApi()
  const addNode = useWorkflowStore((state) => state.addNode)

  const addAtPointer = useCallback(
    (kind: NodeKind, pointer: { x: number; y: number }) => {
      const position = screenToFlowPosition(pointer)
      return addNode(kind, {
        x: position.x - NODE_GRAB_OFFSET.x,
        y: position.y - NODE_GRAB_OFFSET.y,
      })
    },
    [addNode, screenToFlowPosition],
  )

  const addAtViewportCenter = useCallback(
    (kind: NodeKind) => {
      const rect = store.getState().domNode?.getBoundingClientRect()
      const center = rect
        ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const flow = screenToFlowPosition(center)

      // Каскад: если центр занят, ступенькой уходим вправо-вниз до свободного места.
      const nodes = useWorkflowStore.getState().nodes
      let x = flow.x - NODE_GRAB_OFFSET.x
      let y = flow.y - NODE_GRAB_OFFSET.y
      while (isTaken(nodes, x, y)) {
        x += CASCADE_STEP
        y += CASCADE_STEP
      }

      return addNode(kind, { x, y })
    },
    [addNode, screenToFlowPosition, store],
  )

  return { addAtPointer, addAtViewportCenter }
}
