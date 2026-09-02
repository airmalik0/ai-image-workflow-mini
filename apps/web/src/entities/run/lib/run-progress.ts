import { terminalJobStatuses } from '@workflow/contracts'
import type { Job, RunState, RunStatus } from '@workflow/contracts'

/** Русские названия статусов запуска. Со статусами job'а их набор не совпадает. */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  completed: 'завершён',
  failed: 'с ошибкой',
  cancelled: 'отменён',
}

/**
 * Запуск ещё идёт. Отсюда растут сразу два правила интерфейса: отмена доступна
 * только в этом состоянии, а второй запуск, пока не закончился первый, не даётся —
 * иначе предыдущий продолжал бы жечь провайдера, потеряв всякое представление в UI.
 */
export const isRunActive = (status: RunStatus): boolean =>
  status === 'queued' || status === 'running'

/** Job'ы запуска по идентификатору ноды: карточке ноды нужен ровно её job. */
export const jobsByNode = (state: RunState | null): ReadonlyMap<string, Job> =>
  new Map(state === null ? [] : state.jobs.map((job) => [job.nodeId, job]))

export interface RunProgress {
  /** Сколько нод графа уже не изменится: успех, ошибка или пропуск. */
  done: number
  /** Всего нод в графе запуска, а не в текущем холсте: граф после запуска могли править. */
  total: number
  failed: number
}

export const runProgress = (state: RunState | null): RunProgress => {
  if (state === null) return { done: 0, total: 0, failed: 0 }
  const terminal: readonly string[] = terminalJobStatuses
  return {
    done: state.jobs.filter((job) => terminal.includes(job.status)).length,
    total: state.run.graph.nodes.length,
    failed: state.jobs.filter((job) => job.status === 'error').length,
  }
}
