import type { JobStatus, RunStatus, WorkflowGraph } from '@workflow/contracts'
import { buildAdjacency, edgesOf } from '../graph/adjacency.js'

/** Минимум, который планировщику нужно знать о job'е: чей он и в каком состоянии. */
export interface JobState {
  nodeId: string
  status: JobStatus
}

/** Пока хоть один job в этих статусах, run не закончен. */
const PENDING_STATUSES: readonly JobStatus[] = ['idle', 'queued', 'running']

/**
 * Ноды, которые можно ставить в очередь прямо сейчас: сами ещё `idle`, а все их
 * предки уже `success`.
 *
 * Планировщик реактивный, а не волновой: готовность считается по предкам конкретной
 * ноды, а не по завершению целого слоя. Разница видна на ветвлении — быстрая ветка
 * идёт дальше, не дожидаясь медленной соседки, у которой нет с ней общих рёбер.
 *
 * Смотрит только на рёбра графа и статусы job'ов. В NODE_SPECS не заглядывает
 * намеренно: обязательность портов — предмет валидации, а не планирования, и
 * пересчёт готовности не должен зависеть от типа ноды.
 */
export function computeReadyJobs(graph: WorkflowGraph, jobs: JobState[]): string[] {
  const statusOf = new Map(jobs.map((job) => [job.nodeId, job.status]))
  const { incoming } = buildAdjacency(graph)
  const ready: string[] = []

  for (const node of graph.nodes) {
    if (statusOf.get(node.id) !== 'idle') continue
    const deps = edgesOf(incoming, node.id)
    // предок без job'а считается неготовым: запускать ноду вслепую нельзя
    if (deps.every((edge) => statusOf.get(edge.source) === 'success')) ready.push(node.id)
  }

  return ready
}

/**
 * Транзитивные потомки упавшей ноды — те, чьи входы уже никогда не будут заполнены.
 * Сама нода в конус не входит: у неё свой статус `error`. Обход в ширину, поэтому
 * порядок совпадает с порядком удаления от места сбоя.
 */
export function computeSkipCone(graph: WorkflowGraph, failedNodeId: string): string[] {
  const { outgoing } = buildAdjacency(graph)
  const visited = new Set<string>([failedNodeId])
  const cone: string[] = []
  const queue: string[] = [failedNodeId]

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]
    if (current === undefined) continue
    for (const edge of edgesOf(outgoing, current)) {
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      cone.push(edge.target)
      queue.push(edge.target)
    }
  }

  return cone
}

/**
 * Что сбрасывать в `idle` при ручном retry: саму ноду и всех её потомков.
 * Успешные предки не трогаются — их выходы уже сохранены и пересчёту не подлежат.
 */
export function computeRetryScope(graph: WorkflowGraph, nodeId: string): string[] {
  return [nodeId, ...computeSkipCone(graph, nodeId)]
}

/**
 * Статус run'а выводится из ВСЕХ его job'ов, а не из числа успешных: пока есть
 * незавершённые — run `running`; `skipped` считается провалом наравне с `error`,
 * иначе граф, половина которого не выполнялась, отрапортовал бы `completed`.
 *
 * `cancelled` здесь не появляется: отмена — внешнее решение, его выставляет
 * оркестратор, а не производная от статусов job'ов.
 */
export function computeRunStatus(jobs: JobState[]): RunStatus {
  if (jobs.some((job) => PENDING_STATUSES.includes(job.status))) return 'running'
  if (jobs.some((job) => job.status === 'error' || job.status === 'skipped')) return 'failed'
  return 'completed'
}
