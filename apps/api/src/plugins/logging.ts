import type { FastifyInstance } from 'fastify'

/**
 * Ключи, по которым лог склеивается в историю одного запуска. Их достаточно,
 * чтобы в графане отфильтровать всё, что происходило с конкретной нодой:
 * `runId` объединяет запуск, `jobId` и `nodeId` — конкретную попытку.
 */
const CONTEXT_KEYS = ['runId', 'jobId', 'nodeId'] as const

/**
 * Структурный контекст в логах запроса. Без него строки про job'ы приходится
 * связывать по времени — то есть никак, потому что нод в работе несколько сразу.
 *
 * Контекст берётся из параметров маршрута, поэтому хук стоит на `preValidation`:
 * раньше параметры ещё не разобраны, позже — уже поздно, обработчик успел записать
 * первые строки.
 */
export function registerLogContext(app: FastifyInstance): void {
  app.addHook('preValidation', (request, _reply, done) => {
    const params: unknown = request.params
    if (typeof params !== 'object' || params === null) {
      done()
      return
    }

    const context: Record<string, string> = {}
    for (const key of CONTEXT_KEYS) {
      const value = (params as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.length > 0) context[key] = value
    }

    if (Object.keys(context).length > 0) request.log = request.log.child(context)
    done()
  })
}
