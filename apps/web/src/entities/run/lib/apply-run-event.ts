import type { RunEvent, RunState } from '@workflow/contracts'

/**
 * Событие потока, наложенное на состояние запуска. Чистая функция: её же вызывает
 * подписка, чтобы точечно поправить кэш TanStack Query, не перезапрашивая run целиком.
 *
 * `undefined` на входе — состояния ещё нет: запрос за ним либо в полёте, либо ещё не
 * сделан. Придумывать `run` из события нельзя, там нет ни графа, ни времени создания;
 * полное состояние принесёт сам запрос.
 */
export const applyRunEvent = (
  state: RunState | undefined,
  event: RunEvent,
): RunState | undefined => {
  if (state === undefined) return undefined
  if (event.runId !== state.run.id) return state

  switch (event.type) {
    case 'run.started':
      return { ...state, run: { ...state.run, status: 'running', startedAt: event.startedAt } }

    case 'job.updated': {
      const index = state.jobs.findIndex((job) => job.id === event.job.id)
      // Job'а ещё не было в кэше — это первое событие о ноде, а не рассинхрон.
      const jobs =
        index === -1
          ? [...state.jobs, event.job]
          : state.jobs.map((job, at) => (at === index ? event.job : job))
      return { ...state, jobs }
    }

    case 'run.finished':
      return {
        ...state,
        run: { ...state.run, status: event.status, finishedAt: event.finishedAt },
      }
  }
}
