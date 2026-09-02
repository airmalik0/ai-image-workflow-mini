import { executeNode, toJobError } from '@workflow/core'
import type { DispatchPayload, ExecutionDeps, JobDispatcher, JobOutcome } from '@workflow/core'

export type JobFinishedHandler = (
  runId: string,
  nodeId: string,
  outcome: JobOutcome,
) => Promise<void>

/**
 * Исполнитель в том же процессе — для тестов роутов, которым не нужны ни Redis,
 * ни второй процесс. Ведёт себя как боевой: `dispatch` возвращает управление
 * сразу, исполнение уходит в следующий тик, отмена прерывает работу сигналом.
 *
 * Автоматических повторов здесь нет намеренно: они — забота BullMQ, и
 * подделывать их в тесте значило бы проверять не ту реализацию.
 */
export class LocalJobDispatcher implements JobDispatcher {
  readonly #execution: ExecutionDeps
  readonly #running = new Map<string, Set<AbortController>>()
  #onFinished: JobFinishedHandler | null = null

  constructor(execution: ExecutionDeps) {
    this.#execution = execution
  }

  /** Обратный вызов ставится после сборки приложения: движок создаётся внутри него. */
  connect(handler: JobFinishedHandler): void {
    this.#onFinished = handler
  }

  dispatch(payload: DispatchPayload): Promise<void> {
    setImmediate(() => {
      void this.#execute(payload)
    })
    return Promise.resolve()
  }

  cancel(runId: string): Promise<void> {
    for (const controller of this.#running.get(runId) ?? []) controller.abort()
    this.#running.delete(runId)
    return Promise.resolve()
  }

  async #execute(payload: DispatchPayload): Promise<void> {
    const controller = new AbortController()
    const controllers = this.#running.get(payload.runId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.#running.set(payload.runId, controllers)

    let outcome: JobOutcome
    try {
      const output = await executeNode(
        this.#execution,
        payload.node,
        payload.inputs,
        { runId: payload.runId, jobId: payload.jobId, nodeId: payload.nodeId },
        controller.signal,
      )
      outcome = { status: 'success', output }
    } catch (error) {
      outcome = { status: 'error', error: toJobError(error) }
    } finally {
      controllers.delete(controller)
    }

    await this.#onFinished?.(payload.runId, payload.nodeId, outcome)
  }
}
