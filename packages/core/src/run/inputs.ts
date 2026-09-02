import type { Job, JobOutput, WorkflowGraph } from '@workflow/contracts'
import { buildAdjacency, edgesOf } from '../graph/adjacency.js'
import type { ResolvedInputs } from '../ports/job-dispatcher.js'

/** Выходы успешно завершённых job'ов, разложенные по нодам. */
export function outputsByNode(jobs: readonly Job[]): Map<string, JobOutput> {
  const outputs = new Map<string, JobOutput>()
  for (const job of jobs) {
    if (job.status === 'success' && job.output) outputs.set(job.nodeId, job.output)
  }
  return outputs
}

/**
 * Входы ноды: по каждому входящему ребру берётся выход предшественника и кладётся
 * под именем входного порта (`targetHandle`).
 *
 * Именно здесь граф в последний раз участвует в судьбе job'а: дальше уходит
 * самодостаточное задание, и исполнитель про DAG уже ничего не знает.
 */
export function resolveNodeInputs(
  graph: WorkflowGraph,
  nodeId: string,
  outputs: ReadonlyMap<string, JobOutput>,
): ResolvedInputs {
  const { incoming } = buildAdjacency(graph)
  const resolved: ResolvedInputs = {}
  for (const edge of edgesOf(incoming, nodeId)) {
    const output = outputs.get(edge.source)
    if (output) resolved[edge.targetHandle] = output
  }
  return resolved
}
