import { randomUUID } from 'node:crypto'
import fastifyMultipart from '@fastify/multipart'
import fastifyWebsocket from '@fastify/websocket'
import type { PresetRepository, RunRepository, WorkflowRepository } from '@workflow/core'
import type { FileStorage, JobDispatcher } from '@workflow/core'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { ApiConfig } from './config.js'
import type { FileCatalog } from './files/file-catalog.js'
import { registerCors } from './plugins/cors.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerLogContext } from './plugins/logging.js'
import { registerOpenApi } from './plugins/openapi.js'
import type { ProviderRegistry } from './providers/registry.js'
import type { RunEventBus } from './realtime/event-bus.js'
import { apiRoutes } from './routes/index.js'
import { createRunOrchestrator } from './runs/orchestrator.js'
import type { RunOrchestrator } from './runs/orchestrator.js'

/**
 * Проверки живости внешних систем. Функции, а не клиенты: health-роут не должен
 * знать, чем именно проверяется база — запросом `select 1` или чем-то ещё.
 * `redis` необязателен: пока шина событий не подключена, проверять нечего.
 */
export interface HealthProbes {
  database(): Promise<boolean>
  redis?(): Promise<boolean>
}

/**
 * Всё, что приложению нужно снаружи. Зависимости передаются явно, а не берутся
 * из модулей: тест подставляет ин-мемори репозитории и fake-провайдер обычным
 * объектом, без `vi.mock` — а значит проверяет ту же сборку, что уедет в прод.
 */
export interface AppDependencies {
  config: ApiConfig
  presets: PresetRepository
  runs: RunRepository
  /** Постановка job'ов в исполнение: BullMQ на стенде, локальный исполнитель в тестах. */
  dispatcher: JobDispatcher
  /** Шина событий запуска: из неё кормятся SSE и WebSocket. */
  events: RunEventBus
  workflows: WorkflowRepository
  files: FileStorage
  fileCatalog: FileCatalog
  providers: ProviderRegistry
  health: HealthProbes
  /** `false` — тишина в тестах; объект — настройки pino. */
  logger?: FastifyServerOptions['logger']
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDependencies
    /**
     * Движок графа живёт в приложении, а не в зависимостях: он собирается из них
     * и должен существовать в единственном экземпляре — второй движок на тех же
     * данных выдал бы каждой ноде по два исполнения.
     */
    orchestrator: RunOrchestrator
  }
}

/**
 * Сборка приложения. Синхронная: `register` у Fastify ленив, а `inject` сам
 * дожидается готовности — тестам не нужен ни `await`, ни поднятие сокета.
 */
export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? { level: deps.config.logLevel },
    genReqId: (request) => {
      const header = request.headers['x-request-id']
      return typeof header === 'string' && header.length > 0 ? header : randomUUID()
    },
    // multipart разбирает поток сам, поэтому общий лимит тела остаётся
    // «джсоновым»: он защищает от гигабайтного графа, а не от загрузки картинки
    bodyLimit: 4 * 1024 * 1024,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.decorate('deps', deps)
  app.decorate(
    'orchestrator',
    createRunOrchestrator({
      runs: deps.runs,
      dispatcher: deps.dispatcher,
      events: deps.events,
      maxConcurrency: deps.config.maxConcurrentJobs,
      logger: app.log,
    }),
  )

  registerErrorHandler(app, deps.config)
  registerLogContext(app)
  registerCors(app, deps.config)
  registerOpenApi(app)

  void app.register(fastifyMultipart, {
    limits: {
      fileSize: deps.config.maxUploadBytes,
      // одна картинка за запрос: пакетная загрузка UI не нужна,
      // а неограниченное число частей — это способ занять память сервера
      files: 1,
      fields: 8,
    },
  })

  // WebSocket регистрируется до роутов: плагин добавляет опцию `websocket`,
  // и без него маршрут /api/ws поднялся бы обычным GET'ом
  void app.register(fastifyWebsocket)

  void app.register(apiRoutes, { prefix: '/api' })

  return app
}
