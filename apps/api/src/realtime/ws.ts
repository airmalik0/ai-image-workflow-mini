import type { RunEvent } from '@workflow/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { errorEnvelope } from '../http/errors.js'
import { HEARTBEAT_INTERVAL_MS } from './sse.js'

/** Позиция докачки у WebSocket приходит только параметром: заголовков при апгрейде нет. */
const query = z.object({
  runId: z.string().min(1),
  lastEventId: z.string().optional(),
})

const FROM_START = -1

/**
 * Тот же поток событий, другой транспорт. Сделан не ради галочки: SSE
 * односторонний, а WebSocket оставляет дорогу для обратного канала.
 * Контракт событий общий — на клиенте разбирается той же схемой.
 */
export const wsRoutes: FastifyPluginAsyncZod = (app) => {
  const open = new Set<() => void>()

  app.addHook('onClose', () => {
    for (const close of open) close()
    open.clear()
  })

  app.get(
    '/ws',
    {
      websocket: true,
      schema: {
        tags: ['runs'],
        summary: 'Поток событий запуска (WebSocket)',
        description:
          'Альтернатива SSE: те же события, тем же контрактом. Позиция докачки — ?lastEventId=.',
        querystring: query,
      },
    },
    (socket, request) => {
      const parsed = query.safeParse(request.query)
      if (!parsed.success) {
        socket.close(1008, 'runId обязателен')
        return
      }
      const { runId } = parsed.data
      const after = position(parsed.data.lastEventId)

      let lastSent = after
      const send = (event: RunEvent): void => {
        if (event.seq <= lastSent) return
        lastSent = event.seq
        socket.send(JSON.stringify(event))
      }

      void (async () => {
        const run = await app.deps.runs.findRun(runId)
        if (!run) {
          socket.send(JSON.stringify(errorEnvelope('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)))
          socket.close(1008, 'RUN_NOT_FOUND')
          return
        }

        // как и в SSE: живые события ждут, пока уедет история, а повторы
        // отсекаются по возрастанию seq
        let replaying = true
        const buffered: RunEvent[] = []
        const subscription = await app.deps.events.subscribe(runId, (event) => {
          if (replaying) buffered.push(event)
          else send(event)
        })

        const heartbeat = setInterval(() => socket.ping(), HEARTBEAT_INTERVAL_MS)
        heartbeat.unref()

        const close = (): void => {
          if (!open.delete(close)) return
          clearInterval(heartbeat)
          void subscription.close()
          socket.close()
        }
        open.add(close)
        socket.on('close', close)
        socket.on('error', close)

        for (const event of await app.deps.events.history(runId, after)) send(event)
        replaying = false
        for (const event of buffered) send(event)
        buffered.length = 0
      })()
    },
  )

  return Promise.resolve()
}

function position(raw: string | undefined): number {
  if (raw === undefined) return FROM_START
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : FROM_START
}
