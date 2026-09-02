import type { OutgoingHttpHeaders } from 'node:http'
import type { RunEvent } from '@workflow/contracts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ApiError, errorResponses } from '../http/errors.js'

/** Комментарий-пульс: без него прокси режет простаивающее соединение по таймауту. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/** Подсказка браузеру, через сколько переподключаться после разрыва. */
export const RECONNECT_DELAY_MS = 1_000

const params = z.object({ runId: z.string().min(1) })

/**
 * Позиция докачки приходит двумя путями, и поддержать надо оба.
 * Заголовок `Last-Event-ID` браузер шлёт сам при собственном переподключении.
 * Query-параметр использует клиентский код: выставить заголовок у `EventSource`
 * нельзя — его API этого не умеет.
 */
const query = z.object({ lastEventId: z.string().optional() })

const FROM_START = -1

export interface SseRouteOptions {
  /** Период пульса. Задаётся только тестами: в бою он один и заданный константой. */
  heartbeatMs?: number
}

export const sseRoutes: FastifyPluginAsyncZod<SseRouteOptions> = (app, routeOptions) => {
  /** Открытые потоки: их надо закрыть при остановке сервиса, иначе `app.close()` не дождётся. */
  const open = new Set<() => void>()

  app.addHook('onClose', () => {
    for (const close of open) close()
    open.clear()
  })

  app.route({
    method: 'GET',
    url: '/runs/:runId/events',
    schema: {
      tags: ['runs'],
      summary: 'Поток событий запуска (SSE)',
      description:
        'text/event-stream. В каждом кадре есть поле id: без него браузер не пришлёт ' +
        'Last-Event-ID и докачка не работает. Позиция принимается и заголовком ' +
        'Last-Event-ID, и параметром lastEventId. Картинки в поток не идут — только fileId. ' +
        'Тот же поток другим транспортом: WS /api/ws?runId=…&lastEventId=… ' +
        '(в OpenAPI не описан: маршруты с апгрейдом протокола схема не покрывает).',
      params,
      querystring: query,
      produces: ['text/event-stream'],
      // поток описан как unknown: с объявленной схемой ответа тип reply.send сузился бы,
      // а здесь тело пишется в сырой сокет
      response: { 200: z.unknown(), ...errorResponses(404) },
    },
    handler: async (request, reply) => {
      const { runId } = request.params

      // 404 отдаётся ДО заголовков: после них setErrorHandler уже ничего не пришлёт,
      // и клиент получил бы пустой поток вместо внятной ошибки
      const run = await app.deps.runs.findRun(runId)
      if (!run) throw new ApiError('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)

      const after = resumePosition(request)
      const stream = openStream(reply)

      let lastSent = after
      const send = (event: RunEvent): void => {
        if (event.seq <= lastSent) return
        lastSent = event.seq
        stream.event(event)
      }

      // Живые события буферизуются, пока отдаётся история: иначе событие,
      // пришедшее в этот момент, ушло бы раньше более старых.
      // Повтор при этом безвреден — `send` отсекает по возрастанию seq.
      let replaying = true
      const buffered: RunEvent[] = []
      const subscription = await app.deps.events.subscribe(runId, (event) => {
        if (replaying) buffered.push(event)
        else send(event)
      })

      const heartbeat = setInterval(
        () => stream.comment('ping'),
        routeOptions.heartbeatMs ?? HEARTBEAT_INTERVAL_MS,
      )
      heartbeat.unref()

      const close = (): void => {
        if (!open.delete(close)) return
        clearInterval(heartbeat)
        void subscription.close()
        stream.end()
      }
      open.add(close)
      request.raw.on('close', close)

      for (const event of await app.deps.events.history(runId, after)) send(event)
      replaying = false
      for (const event of buffered) send(event)
      buffered.length = 0

      return reply
    },
  })

  return Promise.resolve()
}

export function resumePosition(request: FastifyRequest): number {
  const fromQuery = (request.query as { lastEventId?: string } | undefined)?.lastEventId
  const fromHeader = request.headers['last-event-id']
  const raw = fromQuery ?? (typeof fromHeader === 'string' ? fromHeader : undefined)
  if (raw === undefined) return FROM_START

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : FROM_START
}

interface SseStream {
  event(event: RunEvent): void
  comment(text: string): void
  end(): void
}

function openStream(reply: FastifyReply): SseStream {
  // hijack снимает с Fastify ответственность за ответ: дальше пишем в сокет сами
  reply.hijack()

  // заголовки, уже проставленные плагинами (в первую очередь CORS), обязаны уехать
  // вместе с нашими: writeHead про reply.header ничего не знает, и без этой склейки
  // браузер отвергнет поток по политике источника
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) headers[name] = value
  }

  reply.raw.writeHead(200, {
    ...headers,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // отключает буферизацию у nginx: с ней события копятся и приходят пачкой
    'x-accel-buffering': 'no',
  })
  reply.raw.write(`retry: ${RECONNECT_DELAY_MS}\n\n`)

  let closed = false
  return {
    event: (event) => {
      if (closed) return
      // id: обязателен — без него браузер не пришлёт Last-Event-ID,
      // и докачка существует только на бумаге.
      // Имя события не задаётся намеренно: EventSource.onmessage получает
      // только кадры типа «message», а тип события и так лежит в теле
      reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
    },
    comment: (text) => {
      if (!closed) reply.raw.write(`: ${text}\n\n`)
    },
    end: () => {
      if (closed) return
      closed = true
      reply.raw.end()
    },
  }
}
