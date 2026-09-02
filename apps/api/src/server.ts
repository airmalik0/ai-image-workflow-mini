import { pathToFileURL } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { ConfigError, loadConfig } from './config.js'
import type { ApiConfig } from './config.js'
import { createDatabase, runMigrations } from './db/client.js'
import { DrizzlePresetRepository } from './db/repositories/preset.repository.js'
import { DrizzleRunRepository } from './db/repositories/run.repository.js'
import { DrizzleWorkflowRepository } from './db/repositories/workflow.repository.js'
import { seedDatabase } from './db/seed.js'
import { DrizzleFileCatalog } from './files/file-catalog.js'
import { RedisDemoQuota } from './providers/demo-quota.js'
import { createProviderRegistry } from './providers/registry.js'
import { BullMqDispatcher } from './queue/dispatcher.js'
import {
  createJobsQueue,
  createOutcomesWorker,
  createRedis,
  redisConnection,
} from './queue/queue.js'
import { RedisRunEventBus } from './realtime/event-bus.js'
import { S3FileStorage, createFileStorage } from './storage/index.js'

export interface Runtime {
  app: FastifyInstance
  close(): Promise<void>
}

/**
 * Композиционный корень. Здесь и только здесь боевые адаптеры встречаются
 * с приложением — дальше вниз едут интерфейсы.
 *
 * Порядок шагов не косметический:
 * миграции до сида (сеять некуда в отсутствие таблиц), `ensureBucket` до сида
 * (первый `put` в несуществующий бакет падает), сид до старта HTTP
 * (иначе первый же запрос за пресетами приходит в пустую базу).
 */
export async function createRuntime(config: ApiConfig): Promise<Runtime> {
  const database = createDatabase({ url: config.databaseUrl })
  await runMigrations(database)

  const storage = createFileStorage(config.storage)
  // ensureBucket есть только у S3-адаптера и в порт не входит: каталогу на диске
  // такой шаг не нужен, а тащить пустой метод в интерфейс — врать про порт
  if (storage instanceof S3FileStorage) await storage.ensureBucket()

  await seedDatabase({ db: database.db, storage })

  // общий клиент: флаг отмены, история событий и проверка живости.
  // Очереди свои соединения заводят сами — им нужны блокирующие команды
  const redis = createRedis(config.redisUrl)
  const events = new RedisRunEventBus({ redis, subscriber: redis.duplicate() })
  const jobs = createJobsQueue(redisConnection(config.redisUrl))

  const app = buildApp({
    config,
    presets: new DrizzlePresetRepository(database.db),
    runs: new DrizzleRunRepository(database.db),
    workflows: new DrizzleWorkflowRepository(database.db),
    files: storage,
    fileCatalog: new DrizzleFileCatalog(database.db),
    dispatcher: new BullMqDispatcher({ queue: jobs, redis }),
    events,
    providers: createProviderRegistry(config.provider, {
      storage,
      demoQuota: new RedisDemoQuota({ redis, limit: config.demoDailyLimit }),
    }),
    health: {
      database: async () => {
        await database.pool.query('select 1')
        return true
      },
      redis: async () => (await redis.ping()) === 'PONG',
    },
  })

  /**
   * Ответы исполнителей. Очередь, а не подписка: потерянный результат означает
   * граф, зависший навсегда, — здесь нужна доставка с подтверждением.
   */
  const outcomes = createOutcomesWorker(redisConnection(config.redisUrl), async (message) => {
    await app.orchestrator.onJobFinished(message.runId, message.nodeId, message.outcome)
  })

  return {
    app,
    close: async () => {
      // порядок обратный сборке: сначала перестаём принимать работу,
      // потом закрываем соединения, которыми она пользовалась
      await outcomes.close()
      await app.close()
      await app.orchestrator.drainEvents()
      await events.close()
      await jobs.close()
      await redis.quit()
      await database.close()
    },
  }
}

export async function main(): Promise<void> {
  let config: ApiConfig
  try {
    config = loadConfig()
  } catch (error) {
    // конфигурация — единственная ошибка, которую чинит человек, а не отладчик:
    // стек здесь только мешает прочитать список неверных переменных
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  const runtime = await createRuntime(config)

  // сигналы обрабатываются до listen: контейнер могут остановить и на старте
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      runtime.app.log.info({ signal }, 'остановка сервиса')
      void runtime.close().then(
        () => process.exit(0),
        (error: unknown) => {
          runtime.app.log.error({ err: error }, 'не удалось остановиться штатно')
          process.exit(1)
        },
      )
    })
  }

  await runtime.app.listen({ host: config.host, port: config.port })
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main()
}
