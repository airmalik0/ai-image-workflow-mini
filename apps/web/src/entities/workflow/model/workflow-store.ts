import { NODE_SPECS } from '@workflow/contracts'
import type {
  NodeDataOf,
  NodeKind,
  Position,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '@workflow/contracts'
import { canConnect } from '@workflow/core'
import type { Connection as DomainConnection, ConnectionCheck } from '@workflow/core'
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { create } from 'zustand'

/**
 * Нода канваса. `type` React Flow — это `kind` доменной ноды, `data` — её параметры,
 * поэтому пара «тип → данные» связана дискриминированным объединением: подставить
 * параметры генерации в ноду `prompt` не даст компилятор.
 */
export type TypedFlowNode<K extends NodeKind> = Node<NodeDataOf<K>, K> & { type: K }

export type WorkflowFlowNode = { [K in NodeKind]: TypedFlowNode<K> }[NodeKind]

export type WorkflowFlowEdge = Edge

export interface WorkflowClipboard {
  nodes: WorkflowFlowNode[]
  edges: WorkflowFlowEdge[]
}

export interface WorkflowState {
  nodes: WorkflowFlowNode[]
  edges: WorkflowFlowEdge[]
  clipboard: WorkflowClipboard | null

  onNodesChange: (changes: NodeChange<WorkflowFlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowFlowEdge>[]) => void

  /** Кладёт ноду с параметрами по умолчанию из `NODE_SPECS` и делает её единственной выделенной. */
  addNode: (kind: NodeKind, position: Position) => string
  /** Соединяет порты, если это разрешает `canConnect`; иначе возвращает причину отказа. */
  connect: (connection: Connection) => ConnectionCheck
  /**
   * Точечная правка параметров ноды. Патч сливается с текущими данными и проходит
   * через схему из `NODE_SPECS`: в сторе не может оказаться `data`, которую не
   * примет контракт графа, — а значит и запуск не упадёт на сервере из-за формы.
   */
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  removeSelection: () => void
  copySelection: () => void
  /** Вставляет копию буфера со смещением; вставленное становится выделением. */
  paste: () => void
  selectAll: () => void

  /** Снимок графа в доменном виде — для `validateGraph`, сохранения и запуска. */
  graph: () => WorkflowGraph
  /**
   * Кладёт готовый граф целиком: загрузка сценария и открытие сохранённого
   * workflow. Обратная операция к `graph()` — идентификаторы нод и рёбер
   * сохраняются, иначе связи из графа перестали бы находить свои концы.
   */
  setGraph: (graph: WorkflowGraph) => void
  reset: () => void
}

/** Смещение вставки: копия не ложится точно на оригинал, её видно сразу. */
const PASTE_OFFSET = 32

/**
 * Параметры ноды по умолчанию. У каждого поля в `NODE_SPECS` есть `.default()`,
 * поэтому разбор пустого объекта и даёт значения по умолчанию — второго списка
 * значений на фронте не заводим.
 */
export const defaultNodeData = <K extends NodeKind>(kind: K): NodeDataOf<K> =>
  NODE_SPECS[kind].params.parse({}) as NodeDataOf<K>

/*
 * Два приведения ниже — цена одной и той же особенности TypeScript: он не
 * переносит связь «дискриминант → данные» на значение, у которого дискриминант
 * ещё не сужен до литерала. Пара `kind`/`data` собирается здесь из одного и того
 * же `kind`, поэтому связь не может нарушиться, а разбор по пяти веткам ради
 * компилятора только спрятал бы смысл.
 */
const createNode = (id: string, kind: NodeKind, position: Position): WorkflowFlowNode =>
  ({
    id,
    type: kind,
    position,
    data: defaultNodeData(kind),
    selected: true,
  }) as WorkflowFlowNode

const nextNodeId = (nodes: WorkflowFlowNode[], kind: NodeKind): string => {
  const used = new Set(nodes.map((node) => node.id))
  for (let index = 1; ; index += 1) {
    const id = `${kind}-${index}`
    if (!used.has(id)) return id
  }
}

/** Идентификатор ребра выводится из концов: одно и то же соединение нельзя завести дважды. */
export const edgeId = (connection: DomainConnection): string =>
  `${connection.source}.${connection.sourceHandle}--${connection.target}.${connection.targetHandle}`

/**
 * Кандидат на соединение в доменном виде. React Flow отдаёт хэндлы как `string | null`;
 * у наших нод безымянных портов нет, поэтому `null` — это не соединение.
 */
export const toDomainConnection = (connection: Connection | Edge): DomainConnection | null => {
  const { source, sourceHandle, target, targetHandle } = connection
  if (sourceHandle === null || sourceHandle === undefined) return null
  if (targetHandle === null || targetHandle === undefined) return null
  return { source, sourceHandle, target, targetHandle }
}

const toFlowNode = (node: WorkflowNode): WorkflowFlowNode =>
  ({
    id: node.id,
    type: node.kind,
    position: node.position,
    data: node.data,
    selected: false,
  }) as WorkflowFlowNode

const toDomainNode = (node: WorkflowFlowNode): WorkflowNode =>
  ({
    id: node.id,
    kind: node.type,
    position: node.position,
    data: node.data,
  }) as WorkflowNode

/** Проекция канваса в доменный граф. Рёбра без портов отбрасываются: их не бывает. */
export const toWorkflowGraph = (
  nodes: WorkflowFlowNode[],
  edges: WorkflowFlowEdge[],
): WorkflowGraph => ({
  nodes: nodes.map(toDomainNode),
  edges: edges.flatMap((edge): WorkflowEdge[] => {
    const connection = toDomainConnection(edge)
    return connection ? [{ id: edge.id, ...connection }] : []
  }),
})

const deselect = <T extends { selected?: boolean }>(item: T): T =>
  item.selected === true ? { ...item, selected: false } : item

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  clipboard: null,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges<WorkflowFlowNode>(changes, get().nodes) })
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges<WorkflowFlowEdge>(changes, get().edges) })
  },

  addNode: (kind, position) => {
    const { nodes } = get()
    const id = nextNodeId(nodes, kind)
    set({ nodes: [...nodes.map(deselect), createNode(id, kind, position)] })
    return id
  },

  connect: (connection) => {
    const state = get()
    const candidate = toDomainConnection(connection)
    if (!candidate) return { ok: false, reason: 'Соединение без указанного порта' }

    // Та же функция, что валидирует граф на сервере: правило одно на оба конца.
    const check = canConnect(state.graph(), candidate)
    if (!check.ok) return check

    set({ edges: [...state.edges, { id: edgeId(candidate), ...candidate }] })
    return check
  },

  updateNodeData: (id, patch) => {
    const { nodes } = get()
    const target = nodes.find((node) => node.id === id)
    if (!target) return

    const merged = { ...target.data, ...patch }
    const parsed = NODE_SPECS[target.type].params.safeParse(merged)
    // Схема — последний рубеж: контролы уже ограничивают ввод, но данные ноды
    // уходят на сервер как есть, и хранить в сторе заведомо невалидное нельзя.
    if (!parsed.success) return

    set({
      nodes: nodes.map((node) =>
        node.id === id ? ({ ...node, data: parsed.data } as WorkflowFlowNode) : node,
      ),
    })
  },

  removeSelection: () => {
    const { nodes, edges } = get()
    const removed = new Set(nodes.filter((node) => node.selected === true).map((node) => node.id))
    if (removed.size === 0 && !edges.some((edge) => edge.selected === true)) return

    set({
      nodes: nodes.filter((node) => !removed.has(node.id)),
      // висячих рёбер не остаётся: удаление ноды уносит и всё, что к ней подключено
      edges: edges.filter(
        (edge) => edge.selected !== true && !removed.has(edge.source) && !removed.has(edge.target),
      ),
    })
  },

  copySelection: () => {
    const { nodes, edges } = get()
    const selected = nodes.filter((node) => node.selected === true)
    if (selected.length === 0) return

    const ids = new Set(selected.map((node) => node.id))
    set({
      clipboard: {
        nodes: selected,
        // ребро копируется, только если скопированы оба его конца
        edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      },
    })
  },

  paste: () => {
    const { clipboard, nodes, edges } = get()
    if (!clipboard || clipboard.nodes.length === 0) return

    const renamed = new Map<string, string>()
    const pasted: WorkflowFlowNode[] = []
    for (const node of clipboard.nodes) {
      const id = nextNodeId([...nodes, ...pasted], node.type)
      renamed.set(node.id, id)
      pasted.push({
        ...node,
        id,
        position: { x: node.position.x + PASTE_OFFSET, y: node.position.y + PASTE_OFFSET },
        selected: true,
      })
    }

    const pastedEdges = clipboard.edges.flatMap((edge): WorkflowFlowEdge[] => {
      const source = renamed.get(edge.source)
      const target = renamed.get(edge.target)
      if (source === undefined || target === undefined) return []
      const connection = toDomainConnection({ ...edge, source, target })
      return connection ? [{ ...edge, id: edgeId(connection), source, target, selected: true }] : []
    })

    set({
      nodes: [...nodes.map(deselect), ...pasted],
      edges: [...edges.map(deselect), ...pastedEdges],
    })
  },

  selectAll: () => {
    set({
      nodes: get().nodes.map((node) => ({ ...node, selected: true })),
      edges: get().edges.map((edge) => ({ ...edge, selected: true })),
    })
  },

  graph: () => toWorkflowGraph(get().nodes, get().edges),

  setGraph: (graph) => {
    set({
      nodes: graph.nodes.map(toFlowNode),
      edges: graph.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
        id,
        source,
        sourceHandle,
        target,
        targetHandle,
      })),
    })
  },

  reset: () => {
    set({ nodes: [], edges: [], clipboard: null })
  },
}))
