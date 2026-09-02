import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

/** Где живёт документация. Тот же префикс `/api`, что и у самого API. */
export const DOCS_ROUTE_PREFIX = '/api/docs'

/**
 * OpenAPI собирается из zod-схем контрактов трансформом `jsonSchemaTransform`,
 * а не пишется руками: рукописная спека расходится с кодом на второй же правке,
 * и проверить это расхождение нечем.
 */
export function registerOpenApi(app: FastifyInstance): void {
  void app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'AI Image Workflow Mini',
        description:
          'Node-based редактор AI-workflow: граф как данные, очередь job’ов, realtime-статусы.',
        version: '0.1.0',
      },
      tags: [
        { name: 'system', description: 'Здоровье сервиса и доступные модели' },
        { name: 'presets', description: 'Пресеты промптов и референсов' },
        { name: 'workflows', description: 'Сохранённые графы и их валидация' },
        { name: 'files', description: 'Загрузка и отдача изображений' },
      ],
    },
    transform: jsonSchemaTransform,
  })

  void app.register(fastifySwaggerUi, {
    routePrefix: DOCS_ROUTE_PREFIX,
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })
}
