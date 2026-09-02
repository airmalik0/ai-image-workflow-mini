import type { WorkflowEdge, WorkflowGraph } from '@workflow/contracts'

/**
 * Рёбра графа, разложенные по нодам. Хранятся именно рёбра, а не id соседей:
 * планировщику и валидатору нужны хэндлы, а не только факт связи.
 */
export interface Adjacency {
  incoming: Map<string, WorkflowEdge[]>
  outgoing: Map<string, WorkflowEdge[]>
}

/**
 * Строит списки смежности за один проход. Ноды без рёбер тоже попадают в обе карты
 * с пустыми списками, поэтому по ключам карты можно перечислить весь граф.
 */
export function buildAdjacency(graph: WorkflowGraph): Adjacency {
  const incoming = new Map<string, WorkflowEdge[]>()
  const outgoing = new Map<string, WorkflowEdge[]>()

  for (const node of graph.nodes) {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
  }

  for (const edge of graph.edges) {
    push(outgoing, edge.source, edge)
    push(incoming, edge.target, edge)
  }

  return { incoming, outgoing }
}

/** Список рёбер ноды без возни с `undefined` на каждом обращении к карте. */
export function edgesOf(map: Map<string, WorkflowEdge[]>, nodeId: string): WorkflowEdge[] {
  return map.get(nodeId) ?? []
}

function push(map: Map<string, WorkflowEdge[]>, key: string, edge: WorkflowEdge): void {
  const list = map.get(key)
  if (list) {
    list.push(edge)
    return
  }
  map.set(key, [edge])
}
