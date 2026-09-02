import type { JobOutput, WorkflowNode } from '@workflow/contracts'

/**
 * Входы ноды, уже разрешённые оркестратором: ключ — имя входного порта из
 * `NODE_SPECS`, значение — выход job'а предшественника.
 */
export type ResolvedInputs = Record<string, JobOutput>

/**
 * Самодостаточное задание на исполнение одной ноды. Здесь есть всё, что нужно
 * воркеру, и намеренно нет графа: исполнение не знает про DAG, про зависимости
 * знает только оркестратор. Поэтому задание сериализуется в очередь как есть.
 */
export interface DispatchPayload {
  runId: string
  jobId: string
  nodeId: string
  /** Номер попытки, начиная с 1. */
  attempt: number
  node: WorkflowNode
  inputs: ResolvedInputs
}

/**
 * Порт постановки задания в исполнение. `dispatch` обязан возвращать управление
 * сразу после постановки в очередь, не дожидаясь результата, — иначе оркестратор
 * встанет на первом же job'е и весь параллелизм пропадёт.
 *
 * `cancel` отвечает и за снятие ещё не начатых заданий, и за прерывание уже
 * работающих: сигнал отмены живёт на стороне исполнителя (у воркера свой
 * `AbortController`, доведённый до HTTP-запроса к провайдеру).
 */
export interface JobDispatcher {
  dispatch(payload: DispatchPayload): Promise<void>
  cancel(runId: string): Promise<void>
}
