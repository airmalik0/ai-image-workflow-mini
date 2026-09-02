import { healthResponseSchema, modelsResponseSchema } from '@workflow/contracts'
import type { DemoQuotaStatus } from '@workflow/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { DemoQuota } from '../providers/demo-quota.js'
import { errorResponses } from '../http/errors.js'
import { readDemoQuota } from '../providers/demo-quota.js'

/**
 * Здоровье и справочник моделей.
 *
 * Health обязан отвечать 200 даже на больном стенде: 500 отсюда означает, что
 * оркестратор не сможет отличить «сервис поднялся и видит проблему» от
 * «сервис не поднялся», и перезапустит контейнер, который чинить не нужно.
 */
export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.route({
    method: 'GET',
    url: '/health',
    schema: {
      tags: ['system'],
      summary: 'Состояние сервиса и его зависимостей',
      response: { 200: healthResponseSchema },
    },
    handler: async () => {
      const { health, providers } = app.deps

      const database = await probe(() => health.database())
      const redisProbe = health.redis
      // Redis подключается вместе с realtime (Task 15). Пока проверки нет,
      // он честно отмечен «down», но общий статус не портит: в контракте
      // у поля всего два значения, «не настроен» выразить нечем.
      const redis = redisProbe === undefined ? false : await probe(() => redisProbe())
      const redisHealthy = redisProbe === undefined || redis

      // Предохранитель демо-стенда объявляется здесь: подмена боевого провайдера
      // заглушкой по исчерпании квоты обязана быть видна снаружи, иначе она
      // ничем не отличается от той самой тихой подмены, которая запрещена.
      const demo = providers.demo === null ? null : await probeDemo(providers.demo)

      return {
        status: database && redisHealthy ? ('ok' as const) : ('degraded' as const),
        database: database ? ('up' as const) : ('down' as const),
        redis: redis ? ('up' as const) : ('down' as const),
        provider: demo?.exhausted === true ? 'fake' : providers.active.id,
        ...(demo === null ? {} : { demo }),
      }
    },
  })

  app.route({
    method: 'GET',
    url: '/models',
    schema: {
      tags: ['system'],
      summary: 'Модели поднятых провайдеров',
      response: { 200: modelsResponseSchema, ...errorResponses(500) },
    },
    handler: () => Promise.resolve({ models: [...app.deps.providers.models] }),
  })

  return Promise.resolve()
}

/**
 * Недоступный Redis не должен ронять health вместе со счётчиком квоты: без него
 * узнать остаток нечем, и признак честнее не показывать вовсе, чем показывать
 * нули как «квота свободна».
 */
async function probeDemo(quota: DemoQuota): Promise<DemoQuotaStatus | null> {
  try {
    return await readDemoQuota(quota)
  } catch {
    return null
  }
}

/** Упавшая проверка — это «down», а не пятисотка на весь эндпоинт. */
async function probe(run: () => Promise<boolean>): Promise<boolean> {
  try {
    return await run()
  } catch {
    return false
  }
}
