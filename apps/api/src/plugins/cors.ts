import fastifyCors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import type { ApiConfig } from '../config.js'

/**
 * CORS. По умолчанию открыт: фронт в разработке живёт на другом порту, а публичного
 * стенда с чужими доменами у проекта нет. Ограничение задаётся `CORS_ORIGIN`
 * списком через запятую — на случай, если стенд станет публичным.
 */
export function registerCors(app: FastifyInstance, config: ApiConfig): void {
  void app.register(fastifyCors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Last-Event-ID нужен докачке SSE, остальное — обычные заголовки запроса
    allowedHeaders: ['content-type', 'last-event-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  })
}
