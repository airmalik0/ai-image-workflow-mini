import { NODE_SPECS } from '@workflow/contracts'
import type {
  NodeKind,
  NodeSpec,
  ValidationIssue,
  ValidationResult,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '@workflow/contracts'
import { buildAdjacency, edgesOf } from './adjacency.js'

/**
 * Коды проблем графа. Схема из contracts проверяет структуру, здесь — семантика:
 * дубли идентификаторов, висячие рёбра, несуществующие порты, типы, арность,
 * циклы, обязательные входы и достижимость терминала.
 */
export const GRAPH_ISSUE_CODES = [
  'DUPLICATE_NODE_ID',
  'DUPLICATE_EDGE_ID',
  'EDGE_ENDPOINT_MISSING',
  'UNKNOWN_PORT',
  'PORT_TYPE_MISMATCH',
  'INPUT_PORT_OVERSUBSCRIBED',
  'REQUIRED_INPUT_MISSING',
  'CYCLE_DETECTED',
  'NO_RESULT_NODE',
  'NODE_NOT_CONTRIBUTING',
] as const

export type GraphIssueCode = (typeof GRAPH_ISSUE_CODES)[number]

/** Кандидат на соединение: то же, что отдаёт React Flow в `isValidConnection`. */
export interface Connection {
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export type ConnectionCheck = { ok: true } | { ok: false; reason: string }

const specOf = (kind: NodeKind): NodeSpec => NODE_SPECS[kind]

/**
 * Полная семантическая проверка графа. Ошибки блокируют запуск, предупреждения — нет.
 * Функция не разбирает `data` нод: это забота zod-схемы `workflowGraphSchema`.
 */
export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const nodesById = collectNodes(graph.nodes, errors)
  // дальше работаем на очищенной топологии: рёбра с несуществующими концами
  // и неизвестными портами уже отмечены ошибкой и в обходах не участвуют
  const edges = collectEdges(graph.edges, nodesById, errors)
  const nodes = [...nodesById.values()]
  const { incoming, outgoing } = buildAdjacency({ nodes, edges })

  checkArity(incoming, errors)
  checkRequiredInputs(nodes, incoming, errors)

  for (const cycle of findCycles(nodes, outgoing)) {
    errors.push({
      code: 'CYCLE_DETECTED',
      message: `Граф содержит цикл: ${cycle.join(' → ')} → ${cycle[0] ?? ''}`,
      nodeId: cycle[0] ?? '',
      details: { cycle },
    })
  }

  const resultNodes = nodes.filter((node) => node.kind === 'result')
  if (resultNodes.length === 0) {
    errors.push({
      code: 'NO_RESULT_NODE',
      message: 'В графе нет ни одной ноды result — запускать нечего',
    })
    // без терминала «не ведёт к result» верно для всех нод сразу, шуметь этим бессмысленно
    return { errors, warnings }
  }

  const contributing = reachableBackwards(resultNodes, incoming)
  for (const node of nodes) {
    if (contributing.has(node.id)) continue
    warnings.push({
      code: 'NODE_NOT_CONTRIBUTING',
      message: `Нода «${node.id}» не влияет ни на один result и будет пропущена`,
      nodeId: node.id,
    })
  }

  return { errors, warnings }
}

/**
 * Проверка одного соединения перед его созданием — тот же набор правил, что и в
 * `validateGraph`, но применённый к гипотетическому графу с добавленным ребром.
 * Порядок ответов не случаен: цикл проверяется раньше типов, потому что запрет
 * структурный, тогда как несовместимость портов — свойство конкретной пары хэндлов.
 */
export function canConnect(graph: WorkflowGraph, conn: Connection): ConnectionCheck {
  const source = graph.nodes.find((node) => node.id === conn.source)
  const target = graph.nodes.find((node) => node.id === conn.target)
  if (!source) return { ok: false, reason: `Нода «${conn.source}» не найдена` }
  if (!target) return { ok: false, reason: `Нода «${conn.target}» не найдена` }

  const output = specOf(source.kind).outputs[conn.sourceHandle]
  if (!output) {
    return { ok: false, reason: `У ноды «${source.kind}» нет выхода «${conn.sourceHandle}»` }
  }
  const input = specOf(target.kind).inputs[conn.targetHandle]
  if (!input) {
    return { ok: false, reason: `У ноды «${target.kind}» нет входа «${conn.targetHandle}»` }
  }

  const sameSlot = graph.edges.filter(
    (edge) => edge.target === conn.target && edge.targetHandle === conn.targetHandle,
  )
  if (
    sameSlot.some((edge) => edge.source === conn.source && edge.sourceHandle === conn.sourceHandle)
  ) {
    return { ok: false, reason: 'Такое соединение уже есть' }
  }
  if (sameSlot.length > 0) {
    return { ok: false, reason: `Вход «${conn.targetHandle}» уже занят другим соединением` }
  }

  const hypothetical: WorkflowEdge = { id: '__candidate__', ...conn }
  const { outgoing } = buildAdjacency({ nodes: graph.nodes, edges: [...graph.edges, hypothetical] })
  if (findCycles(graph.nodes, outgoing).length > 0) {
    return { ok: false, reason: 'Соединение замкнёт граф в цикл' }
  }

  if (output.type !== input.type) {
    return { ok: false, reason: `Порт типа «${output.type}» нельзя соединить с «${input.type}»` }
  }

  return { ok: true }
}

function collectNodes(nodes: WorkflowNode[], errors: ValidationIssue[]): Map<string, WorkflowNode> {
  const byId = new Map<string, WorkflowNode>()
  for (const node of nodes) {
    if (byId.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `Идентификатор ноды «${node.id}» встречается дважды`,
        nodeId: node.id,
      })
      continue
    }
    byId.set(node.id, node)
  }
  return byId
}

function collectEdges(
  edges: WorkflowEdge[],
  nodesById: Map<string, WorkflowNode>,
  errors: ValidationIssue[],
): WorkflowEdge[] {
  const seen = new Set<string>()
  const kept: WorkflowEdge[] = []

  for (const edge of edges) {
    if (seen.has(edge.id)) {
      errors.push({
        code: 'DUPLICATE_EDGE_ID',
        message: `Идентификатор ребра «${edge.id}» встречается дважды`,
        edgeId: edge.id,
      })
      continue
    }
    seen.add(edge.id)

    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) {
      errors.push({
        code: 'EDGE_ENDPOINT_MISSING',
        message: `Ребро «${edge.id}» ссылается на несуществующую ноду «${source ? edge.target : edge.source}»`,
        edgeId: edge.id,
      })
      continue
    }

    const output = specOf(source.kind).outputs[edge.sourceHandle]
    const input = specOf(target.kind).inputs[edge.targetHandle]
    if (!output || !input) {
      errors.push({
        code: 'UNKNOWN_PORT',
        message: output
          ? `У ноды «${target.kind}» нет входа «${edge.targetHandle}»`
          : `У ноды «${source.kind}» нет выхода «${edge.sourceHandle}»`,
        edgeId: edge.id,
        nodeId: output ? target.id : source.id,
      })
      continue
    }

    if (output.type !== input.type) {
      errors.push({
        code: 'PORT_TYPE_MISMATCH',
        message: `Ребро «${edge.id}» соединяет «${output.type}» с «${input.type}»`,
        edgeId: edge.id,
        details: { from: output.type, to: input.type },
      })
    }

    // ребро с несовместимыми типами остаётся в топологии: оно всё равно образует
    // связь, и цикл через него — тоже цикл, о котором надо сообщить
    kept.push(edge)
  }

  return kept
}

/** У входного порта не более одного источника; выход ветвится свободно. */
function checkArity(incoming: Map<string, WorkflowEdge[]>, errors: ValidationIssue[]): void {
  for (const [nodeId, edges] of incoming) {
    const byHandle = new Map<string, WorkflowEdge[]>()
    for (const edge of edges) {
      byHandle.set(edge.targetHandle, [...(byHandle.get(edge.targetHandle) ?? []), edge])
    }
    for (const [handle, group] of byHandle) {
      if (group.length < 2) continue
      errors.push({
        code: 'INPUT_PORT_OVERSUBSCRIBED',
        message: `У входа «${handle}» ноды «${nodeId}» ${group.length} источника, допустим один`,
        nodeId,
        details: { port: handle, edgeIds: group.map((edge) => edge.id) },
      })
    }
  }
}

function checkRequiredInputs(
  nodes: WorkflowNode[],
  incoming: Map<string, WorkflowEdge[]>,
  errors: ValidationIssue[],
): void {
  for (const node of nodes) {
    const connected = new Set(edgesOf(incoming, node.id).map((edge) => edge.targetHandle))
    for (const [handle, port] of Object.entries(specOf(node.kind).inputs)) {
      if (!port.required || connected.has(handle)) continue
      errors.push({
        code: 'REQUIRED_INPUT_MISSING',
        message: `Вход «${handle}» ноды «${node.id}» обязателен, но ни с чем не соединён`,
        nodeId: node.id,
        details: { port: handle },
      })
    }
  }
}

const WHITE = 0
const GRAY = 1
const BLACK = 2

/**
 * Обход в глубину тремя цветами. Итеративный намеренно: граф приходит из HTTP,
 * и рекурсия на длинной цепочке уронила бы процесс переполнением стека.
 * Серая вершина на пути — задняя дуга, сам цикл вырезается из текущего пути.
 */
function findCycles(nodes: WorkflowNode[], outgoing: Map<string, WorkflowEdge[]>): string[][] {
  const color = new Map<string, number>(nodes.map((node) => [node.id, WHITE]))
  const cycles: string[][] = []
  const reported = new Set<string>()

  for (const root of nodes) {
    if (color.get(root.id) !== WHITE) continue

    const path: string[] = [root.id]
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }]
    color.set(root.id, GRAY)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (!frame) break

      const edges = edgesOf(outgoing, frame.id)
      const edge = edges[frame.next]
      if (!edge) {
        color.set(frame.id, BLACK)
        stack.pop()
        path.pop()
        continue
      }
      frame.next += 1

      const next = edge.target
      const state = color.get(next)
      if (state === GRAY) {
        const from = path.indexOf(next)
        const cycle = path.slice(from === -1 ? 0 : from)
        const key = [...cycle].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          cycles.push(cycle)
        }
        continue
      }
      if (state === WHITE) {
        color.set(next, GRAY)
        path.push(next)
        stack.push({ id: next, next: 0 })
      }
    }
  }

  return cycles
}

/** Обратный обход в ширину от терминалов: кто реально влияет хотя бы на один result. */
function reachableBackwards(
  from: WorkflowNode[],
  incoming: Map<string, WorkflowEdge[]>,
): Set<string> {
  const visited = new Set(from.map((node) => node.id))
  const queue = [...visited]

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]
    if (current === undefined) continue
    for (const edge of edgesOf(incoming, current)) {
      if (visited.has(edge.source)) continue
      visited.add(edge.source)
      queue.push(edge.source)
    }
  }

  return visited
}
