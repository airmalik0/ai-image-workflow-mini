import type { FileStorage } from '@workflow/core'
import { z } from 'zod'
import { FsFileStorage } from './fs-storage.js'
import { S3FileStorage } from './s3-storage.js'

export { FsFileStorage, contentId } from './fs-storage.js'
export { S3FileStorage } from './s3-storage.js'
export type { FsFileStorageOptions } from './fs-storage.js'
export type { S3FileStorageOptions } from './s3-storage.js'

export const fileStorageConfigSchema = z.discriminatedUnion('driver', [
  z.object({
    driver: z.literal('fs'),
    dataDir: z.string().min(1),
    publicBaseUrl: z.string().min(1).optional(),
  }),
  z.object({
    driver: z.literal('s3'),
    bucket: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().min(1).optional(),
    accessKeyId: z.string().min(1).optional(),
    secretAccessKey: z.string().min(1).optional(),
    forcePathStyle: z.boolean().optional(),
    keyPrefix: z.string().optional(),
    publicBaseUrl: z.string().min(1).optional(),
  }),
])

export type FileStorageConfig = z.infer<typeof fileStorageConfigSchema>

export function createFileStorage(config: FileStorageConfig): FileStorage {
  return config.driver === 's3' ? new S3FileStorage(config) : new FsFileStorage(config)
}

/**
 * Разбор переменных окружения. Драйвер по умолчанию — `fs`: приложение обязано
 * подниматься без единой внешней настройки, иначе «docker compose up» из README
 * перестаёт быть правдой.
 */
export function fileStorageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FileStorageConfig {
  const driver = env.STORAGE_DRIVER ?? 'fs'
  if (driver === 's3') {
    return fileStorageConfigSchema.parse({
      driver: 's3',
      bucket: env.S3_BUCKET,
      region: env.S3_REGION ?? 'ru-central1',
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle:
        env.S3_FORCE_PATH_STYLE === undefined ? undefined : env.S3_FORCE_PATH_STYLE === 'true',
      keyPrefix: env.S3_KEY_PREFIX,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    })
  }
  return fileStorageConfigSchema.parse({
    driver: 'fs',
    dataDir: env.DATA_DIR ?? './data/files',
    publicBaseUrl: env.FILES_PUBLIC_BASE_URL,
  })
}
