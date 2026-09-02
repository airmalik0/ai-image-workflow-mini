import { pathToFileURL } from 'node:url'
import {
  ConfigError,
  DrizzlePresetRepository,
  createDatabase,
  createFileStorage,
  createOutcomesQueue,
  createProviderRegistry,
  RedisDemoQuota,
  createRedis,
  loadConfig,
  redisConnection,
} from '@workflow/api'
import type { ApiConfig } from '@workflow/api'
import { pino } from 'pino'
import { RedisCancellation } from './cancellation.js'
import { createJobWorker } from './process-job.js'

export interface WorkerRuntime {
  close(): Promise<void>
}

/**
 * Процесс-исполнитель. Тот же образ, что и у API, другая команда: конфигурация,
 * хранилище и провайдеры собираются одним и тем же кодом — две реализации
 * одной конфигурации разошлись бы на первом же изменении.
 *
 * Про граф воркер не знает ничего. Он получает самодостаточное задание, поэтому
 * его можно масштабировать репликами, не трогая оркестратор.
 */
export async function createWorkerRuntime(config: ApiConfig): Promise<WorkerRuntime> {
  const logger = pino({ level: config.logLevel, name: 'worker' })

  const database = createDatabase({ url: config.databaseUrl, maxConnections: 4 })
  const storage = createFileStorage(config.storage)

  // Redis поднимается до провайдеров: дневная квота демо-стенда живёт в нём,
  // и считает её именно воркер — генерация происходит здесь
  const redis = createRedis(config.redisUrl)
  const providers = createProviderRegistry(config.provider, {
    storage,
    demoQuota: new RedisDemoQuota({ redis, limit: config.demoDailyLimit }),
  })

  const cancellation = new RedisCancellation({ redis, subscriber: redis.duplicate() })
  await cancellation.start()

  const outcomes = createOutcomesQueue(redisConnection(config.redisUrl))
  const worker = createJobWorker({
    connection: redisConnection(config.redisUrl),
    concurrency: config.workerConcurrency,
    execution: {
      provider: providers.active,
      storage,
      presets: new DrizzlePresetRepository(database.db),
    },
    outcomes,
    cancellation,
    logger,
  })

  worker.on('error', (error) => {
    logger.error({ err: error }, 'ошибка воркера')
  })

  logger.info(
    { provider: providers.active.id, concurrency: config.workerConcurrency },
    'воркер поднят',
  )

  return {
    close: async () => {
      // close(true) не ждёт текущих заданий; здесь ждём — прерванная генерация
      // это списанные деньги провайдера и job, который придётся повторять
      await worker.close()
      await cancellation.close()
      await outcomes.close()
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
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  const runtime = await createWorkerRuntime(config)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void runtime.close().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    })
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main()
}
