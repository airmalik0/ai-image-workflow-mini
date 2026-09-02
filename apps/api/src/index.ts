export { buildApp } from './app.js'
export type { AppDependencies, HealthProbes } from './app.js'
export { ConfigError, DEFAULT_MAX_UPLOAD_BYTES, loadConfig } from './config.js'
export type { ApiConfig } from './config.js'
export { createRuntime, main } from './server.js'
export type { Runtime } from './server.js'
export { ApiError, API_ERROR_CODES, STATUS_BY_CODE, errorEnvelope } from './http/errors.js'
export type { ApiErrorCode } from './http/errors.js'
export { DrizzleFileCatalog } from './files/file-catalog.js'
export type { FileCatalog, FileCatalogEntry } from './files/file-catalog.js'

// Ниже — то, чем пользуется процесс-воркер. Он живёт в том же образе и берёт
// сборку соединений, хранилища и провайдеров отсюда, а не заводит свою копию:
// две реализации одной конфигурации расходятся на первом же изменении.
export { createDatabase, runMigrations } from './db/client.js'
export type { Database, Db } from './db/client.js'
export { DrizzlePresetRepository } from './db/repositories/preset.repository.js'
export { DrizzleRunRepository } from './db/repositories/run.repository.js'
export { createProviderRegistry } from './providers/registry.js'
export type { ProviderEnvironment, ProviderRegistry } from './providers/registry.js'
export { DemoLimitedProvider } from './providers/demo-limited-provider.js'
export {
  RedisDemoQuota,
  demoQuotaKey,
  nextMidnightUtc,
  readDemoQuota,
} from './providers/demo-quota.js'
export type { DemoQuota } from './providers/demo-quota.js'
export { S3FileStorage, createFileStorage } from './storage/index.js'
export type { FileStorageConfig } from './storage/index.js'

export { BullMqDispatcher } from './queue/dispatcher.js'
export type { BullMqDispatcherOptions } from './queue/dispatcher.js'
export {
  CANCEL_FLAG_TTL_SECONDS,
  DEFAULT_BACKOFF_MS,
  DEFAULT_JOB_ATTEMPTS,
  EXECUTE_NODE,
  JOBS_QUEUE,
  OUTCOMES_QUEUE,
  RUN_CANCEL_CHANNEL,
  createJobsQueue,
  createOutcomesQueue,
  createOutcomesWorker,
  createRedis,
  jobIdOf,
  redisConnection,
  runCancelledKey,
  runJobsKey,
} from './queue/queue.js'
export type { JobOutcomeMessage } from './queue/queue.js'

export {
  RUN_EVENT_HISTORY_LIMIT,
  RUN_EVENT_TTL_SECONDS,
  RedisRunEventBus,
  runHistoryKey,
  runSeqKey,
} from './realtime/event-bus.js'
export type {
  RedisRunEventBusOptions,
  RunEventBus,
  RunEventHandler,
  RunEventInput,
  RunEventSubscription,
} from './realtime/event-bus.js'

export { createRunOrchestrator } from './runs/orchestrator.js'
export type { RunOrchestrator, RunOrchestratorDeps } from './runs/orchestrator.js'
