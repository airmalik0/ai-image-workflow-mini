import { describe, expect, it } from 'vitest'
import { FsFileStorage } from './fs-storage.js'
import { createFileStorage, fileStorageConfigFromEnv } from './index.js'
import { S3FileStorage } from './s3-storage.js'

describe('createFileStorage', () => {
  it('по умолчанию собирает файловый адаптер', () => {
    expect(createFileStorage({ driver: 'fs', dataDir: '/tmp/x' })).toBeInstanceOf(FsFileStorage)
  })

  it('по STORAGE_DRIVER=s3 собирает S3-адаптер', () => {
    const storage = createFileStorage({
      driver: 's3',
      bucket: 'demo',
      region: 'ru-central1',
      endpoint: 'https://storage.yandexcloud.net',
    })

    expect(storage).toBeInstanceOf(S3FileStorage)
  })
})

describe('fileStorageConfigFromEnv', () => {
  it('без переменных окружения даёт рабочий файловый адаптер', () => {
    expect(fileStorageConfigFromEnv({})).toEqual({ driver: 'fs', dataDir: './data/files' })
  })

  it('читает DATA_DIR', () => {
    expect(fileStorageConfigFromEnv({ DATA_DIR: '/var/data' })).toMatchObject({
      driver: 'fs',
      dataDir: '/var/data',
    })
  })

  it('собирает конфиг S3 из переменных Yandex Object Storage', () => {
    expect(
      fileStorageConfigFromEnv({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'workflow-demo',
        S3_ENDPOINT: 'https://storage.yandexcloud.net',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    ).toEqual({
      driver: 's3',
      bucket: 'workflow-demo',
      region: 'ru-central1',
      endpoint: 'https://storage.yandexcloud.net',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    })
  })

  it('падает на старте, если для s3 не назван бакет', () => {
    // лучше не подняться, чем принять загрузку и потерять её
    expect(() => fileStorageConfigFromEnv({ STORAGE_DRIVER: 's3' })).toThrow()
  })
})
