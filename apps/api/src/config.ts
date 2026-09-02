import { z } from 'zod'
import type { ProviderEnvironment } from './providers/registry.js'
import type { FileStorageConfig } from './storage/index.js'
import { fileStorageConfigFromEnv } from './storage/index.js'

/** 15 МБ — фотография с телефона проходит, а великоватый PSD уже нет. */
export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Ошибка конфигурации. Отдельный класс нужен, чтобы `server.ts` мог отличить
 * «человек неверно заполнил .env» от падения инфраструктуры и напечатать первое
 * без стека: стек здесь бесполезен, а список неверных переменных — нет.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export type LogLevel = (typeof logLevels)[number]

const integer = z.coerce.number().int()

/**
 * Схема окружения. Значения по умолчанию есть у всего, кроме секретов:
 * `docker compose up` из README обязан подниматься на пустом `.env`,
 * иначе первое знакомство с проектом начинается с отладки конфигурации.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: integer.min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(logLevels).default('info'),

  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/workflow'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  MAX_UPLOAD_BYTES: integer.positive().default(DEFAULT_MAX_UPLOAD_BYTES),
  MAX_CONCURRENT_JOBS: integer.positive().max(64).default(4),
  WORKER_CONCURRENCY: integer.positive().max(64).default(4),

  /** `*` — разрешены любые источники; иначе список через запятую. */
  CORS_ORIGIN: z.string().min(1).default('*'),

  /** Дневной потолок обращений к боевому провайдеру. 0 — предохранитель выключен. */
  DEMO_DAILY_LIMIT: integer.min(0).default(0),

  IMAGE_PROVIDER: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  GEMINI_IMAGE_SIZE: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  FAKE_FAIL_NODES: z.string().min(1).optional(),
})

export interface ApiConfig {
  env: 'development' | 'test' | 'production'
  host: string
  port: number
  logLevel: LogLevel
  databaseUrl: string
  /**
   * Очередь и шина событий. Значение по умолчанию есть, как и у базы: без Redis
   * граф не исполняется вовсе, поэтому «не настроен» — не рабочее состояние,
   * а повод честно упасть на первой же проверке живости.
   */
  redisUrl: string
  maxUploadBytes: number
  /** Потолок оркестратора: сколько job'ов вообще отдаётся исполнителям. */
  maxConcurrentJobs: number
  /** Потолок одного процесса-воркера: сколько job'ов он тянет параллельно. */
  workerConcurrency: number
  /** `true` — любой источник; иначе явный список. Формат `@fastify/cors`. */
  corsOrigin: true | string[]
  /**
   * Сколько успешных обращений к боевому провайдеру разрешено за сутки.
   * `0` — без ограничения. Предохранитель нужен публичному демо-стенду:
   * он ходит в платный API по ключу владельца.
   */
  demoDailyLimit: number
  /** Отдаётся `createProviderRegistry` как есть: реестр сам решает, кого поднимать. */
  provider: ProviderEnvironment
  storage: FileStorageConfig
}

/**
 * Разбор окружения. Падает на первом же старте, а не на первом запросе:
 * опечатка в `PORT` обязана убить процесс, пока её видно в логе деплоя.
 *
 * Пустая строка считается отсутствующим значением — `.env.example` раздаёт
 * пустые `GEMINI_API_KEY=` и `REDIS_URL=`, и трактовать их как заданные
 * означало бы падать на файле, скопированном ровно по инструкции.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const source = withoutBlanks(env)
  const parsed = environmentSchema.safeParse(source)
  if (!parsed.success) throw new ConfigError(describeIssues(parsed.error))

  const value = parsed.data
  let storage: FileStorageConfig
  try {
    storage = fileStorageConfigFromEnv(source)
  } catch (error) {
    throw new ConfigError(
      error instanceof z.ZodError
        ? describeIssues(error, storageVariable)
        : `Неверная конфигурация файлового хранилища: ${String(error)}`,
    )
  }

  return {
    env: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    maxUploadBytes: value.MAX_UPLOAD_BYTES,
    maxConcurrentJobs: value.MAX_CONCURRENT_JOBS,
    workerConcurrency: value.WORKER_CONCURRENCY,
    corsOrigin: parseCorsOrigin(value.CORS_ORIGIN),
    demoDailyLimit: value.DEMO_DAILY_LIMIT,
    provider: {
      IMAGE_PROVIDER: value.IMAGE_PROVIDER,
      GEMINI_API_KEY: value.GEMINI_API_KEY,
      OPENAI_API_KEY: value.OPENAI_API_KEY,
      GEMINI_MODEL: value.GEMINI_MODEL,
      GEMINI_IMAGE_SIZE: value.GEMINI_IMAGE_SIZE,
      OPENAI_MODEL: value.OPENAI_MODEL,
      FAKE_FAIL_NODES: value.FAKE_FAIL_NODES,
    },
    storage,
  }
}

function parseCorsOrigin(raw: string): true | string[] {
  if (raw.trim() === '*') return true
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

/**
 * Пустые строки выбрасываются до разбора: иначе `PORT=` превратился бы
 * в `Number('') === 0` и падал бы с сообщением про нижнюю границу вместо
 * честного «переменная не задана, взято значение по умолчанию».
 */
function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, raw] of Object.entries(env)) {
    if (typeof raw === 'string' && raw.trim().length === 0) continue
    if (raw === undefined) continue
    result[key] = raw
  }
  return result
}

/** Все проблемы разом: чинить конфигурацию по одной ошибке за перезапуск — пытка. */
function describeIssues(
  error: z.ZodError,
  name = (path: PropertyKey[]) => String(path[0]),
): string {
  const lines = error.issues.map((issue) => `  ${name(issue.path)}: ${issue.message}`)
  return `Неверные переменные окружения:\n${lines.join('\n')}`
}

/** У хранилища имена переменных не совпадают с ключами схемы — сообщаем полезное. */
function storageVariable(path: PropertyKey[]): string {
  const field = String(path[0])
  const known: Record<string, string> = {
    bucket: 'S3_BUCKET',
    region: 'S3_REGION',
    endpoint: 'S3_ENDPOINT',
    accessKeyId: 'S3_ACCESS_KEY_ID',
    secretAccessKey: 'S3_SECRET_ACCESS_KEY',
    dataDir: 'DATA_DIR',
  }
  return known[field] ?? field
}
