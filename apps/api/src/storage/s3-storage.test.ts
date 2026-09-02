import { randomUUID } from 'node:crypto'
import { DomainError } from '@workflow/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { S3FileStorage } from './s3-storage.js'

/**
 * Тесты идут против настоящего S3-совместимого хранилища — локального MinIO:
 *
 * ```
 * docker run -d --name aiwf-test-minio -e MINIO_ROOT_USER=minioadmin \
 *   -e MINIO_ROOT_PASSWORD=minioadmin -p 55900:9000 minio/minio:latest server /data
 * ```
 *
 * Мок S3-клиента проверил бы только то, что мы правильно вызвали свой же мок:
 * ни path-style адресация, ни имя ошибки `NoSuchKey` так не проверяются.
 */
const ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:55900'
const ACCESS_KEY = process.env.TEST_S3_ACCESS_KEY_ID ?? 'minioadmin'
const SECRET_KEY = process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'minioadmin'

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function build(bucket: string, publicBaseUrl?: string): S3FileStorage {
  return new S3FileStorage({
    bucket,
    region: 'us-east-1',
    endpoint: ENDPOINT,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    forcePathStyle: true,
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
  })
}

const bucket = `aiwf-test-${randomUUID().slice(0, 8)}`
let unavailable: string | null = null

try {
  const response = await fetch(`${ENDPOINT}/minio/health/live`, {
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok) unavailable = `MinIO ответил ${String(response.status)}`
} catch (error) {
  unavailable = error instanceof Error ? error.message : String(error)
}

if (unavailable !== null) {
  // stderr, а не console: вывод на этапе загрузки модуля vitest не показывает
  process.stderr.write(
    `[s3] тесты против MinIO пропущены — хранилище недоступно: ${unavailable}\n` +
      '     Поднять: docker run -d --name aiwf-test-minio -e MINIO_ROOT_USER=minioadmin ' +
      '-e MINIO_ROOT_PASSWORD=minioadmin -p 55900:9000 minio/minio:latest server /data\n',
  )
}

describe.skipIf(unavailable !== null)('S3FileStorage', () => {
  let storage: S3FileStorage

  beforeAll(async () => {
    storage = build(bucket)
    await storage.ensureBucket()
  })

  afterAll(() => {
    // бакет остаётся в локальном MinIO: чистить его дороже, чем пересоздать контейнер
  })

  it('возвращает те же байты и тот же mimeType', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')
    const file = await storage.get(id)

    expect(new Uint8Array(file.bytes)).toEqual(PNG_HEADER)
    expect(file.mimeType).toBe('image/png')
  })

  it('идентификатор — тот же хеш содержимого, что и у fs-адаптера', async () => {
    const first = await storage.put(PNG_HEADER, 'image/png')
    const second = await storage.put(Uint8Array.from(PNG_HEADER), 'image/png')

    expect(second).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('на неизвестный ключ бросает FILE_NOT_FOUND', async () => {
    await expect(storage.get('f'.repeat(64))).rejects.toBeInstanceOf(DomainError)
    await expect(storage.get('f'.repeat(64))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  it('переживает файл реального размера', async () => {
    const big = new Uint8Array(3 * 1024 * 1024)
    for (let index = 0; index < big.length; index += 1) big[index] = index % 251

    const id = await storage.put(big, 'image/jpeg')
    const file = await storage.get(id)

    expect(Buffer.from(file.bytes).equals(Buffer.from(big))).toBe(true)
  })

  it('ensureBucket идемпотентен', async () => {
    await expect(storage.ensureBucket()).resolves.toBeUndefined()
  })

  it('по умолчанию отдаёт файлы через API, а с publicBaseUrl — напрямую из бакета', async () => {
    const id = 'a'.repeat(64)

    expect(storage.url(id)).toBe(`/api/files/${id}`)
    expect(build(bucket, 'https://storage.yandexcloud.net/demo').url(id)).toBe(
      `https://storage.yandexcloud.net/demo/${id}`,
    )
  })
})
