import {
  InMemoryFileStorage,
  InMemoryPresetRepository,
  InMemoryRunRepository,
} from '@workflow/core/testing'
import type {
  FileStorage,
  ImageProvider,
  JobDispatcher,
  PresetRepository,
  RunRepository,
  WorkflowRepository,
} from '@workflow/core'
import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import type { AppDependencies, HealthProbes } from '../app.js'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import type { ApiConfig } from '../config.js'
import type { FileCatalog } from '../files/file-catalog.js'
import type { DemoQuota } from '../providers/demo-quota.js'
import { createProviderRegistry } from '../providers/registry.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { RunEventBus } from '../realtime/event-bus.js'
import { InMemoryFileCatalog } from './in-memory-file-catalog.js'
import { InMemoryRunEventBus } from './in-memory-event-bus.js'
import { InMemoryWorkflowRepository } from './in-memory-workflow-repository.js'
import { LocalJobDispatcher } from './local-dispatcher.js'

export interface TestAppOverrides {
  env?: NodeJS.ProcessEnv
  config?: Partial<ApiConfig>
  presets?: PresetRepository
  runs?: RunRepository
  workflows?: WorkflowRepository
  files?: FileStorage
  fileCatalog?: FileCatalog
  dispatcher?: JobDispatcher
  events?: RunEventBus
  /** Свой провайдер: тестам нужны задержка и управляемое падение конкретных нод. */
  provider?: ImageProvider
  /** Дневная квота демо-стенда: без неё предохранитель выключен. */
  demoQuota?: DemoQuota
  logger?: FastifyServerOptions['logger']
  database?: HealthProbes['database']
  redis?: HealthProbes['redis']
}

export interface TestApp {
  app: FastifyInstance
  deps: AppDependencies
}

/**
 * Приложение на ин-мемори зависимостях и fake-провайдере. Ни базы, ни сети:
 * роуты проверяются через `inject`, а подмена делается объектом зависимостей,
 * а не `vi.mock` — тест собирает ровно то же приложение, что и `server.ts`.
 */
export function buildTestDependencies(overrides: TestAppOverrides = {}): AppDependencies {
  const config: ApiConfig = {
    ...loadConfig({ IMAGE_PROVIDER: 'fake', ...overrides.env }),
    ...overrides.config,
  }
  const files = overrides.files ?? new InMemoryFileStorage()
  const presets = overrides.presets ?? new InMemoryPresetRepository()
  const providers =
    overrides.provider === undefined
      ? createProviderRegistry(config.provider, {
          storage: files,
          ...(overrides.demoQuota === undefined ? {} : { demoQuota: overrides.demoQuota }),
        })
      : singleProviderRegistry(overrides.provider)

  return {
    config,
    presets,
    runs: overrides.runs ?? new InMemoryRunRepository(),
    workflows: overrides.workflows ?? new InMemoryWorkflowRepository(),
    files,
    fileCatalog: overrides.fileCatalog ?? new InMemoryFileCatalog(),
    dispatcher:
      overrides.dispatcher ?? new LocalJobDispatcher({ providers, storage: files, presets }),
    events: overrides.events ?? new InMemoryRunEventBus(),
    providers,
    health: {
      database: overrides.database ?? (() => Promise.resolve(true)),
      ...(overrides.redis === undefined ? {} : { redis: overrides.redis }),
    },
    logger: overrides.logger ?? false,
  }
}

/**
 * Сборка приложения для теста. Локальный исполнитель подключается к движку
 * здесь: движок создаётся внутри `buildApp`, и раньше подключать его не к чему.
 */
/** Реестр из одного провайдера — подмена целиком, без разбора переменных окружения. */
function singleProviderRegistry(provider: ImageProvider): ProviderRegistry {
  return {
    active: provider,
    byId: new Map([[provider.id, provider]]),
    models: provider.models,
    demo: null,
    get: (id) => (id === provider.id ? provider : undefined),
    // выбирать не из кого: провайдер один, и он исполняет любую модель
    forModel: () => provider,
  }
}

export function buildTestApp(overrides: TestAppOverrides = {}): FastifyInstance {
  const deps = buildTestDependencies(overrides)
  const app = buildApp(deps)
  if (deps.dispatcher instanceof LocalJobDispatcher) {
    deps.dispatcher.connect((runId, nodeId, outcome) =>
      app.orchestrator.onJobFinished(runId, nodeId, outcome),
    )
  }
  return app
}
