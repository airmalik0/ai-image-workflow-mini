import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { FileStorage, StoredFile } from '@workflow/core'
import { DomainError } from '@workflow/core'
import { contentId } from './fs-storage.js'

export interface S3FileStorageOptions {
  bucket: string
  region: string
  /** Пусто — настоящий AWS; заполнено — Yandex Object Storage, MinIO, R2. */
  endpoint?: string | undefined
  accessKeyId?: string | undefined
  secretAccessKey?: string | undefined
  /**
   * MinIO и локальные стенды понимают только path-style адреса
   * (`http://host/bucket/key`), потому что виртуальные хосты им негде взять.
   */
  forcePathStyle?: boolean | undefined
  /** Префикс ключей внутри бакета: один бакет можно делить между стендами. */
  keyPrefix?: string | undefined
  /** База публичного адреса, если бакет читается напрямую. Иначе файлы отдаёт API. */
  publicBaseUrl?: string | undefined
}

const DEFAULT_MIME = 'application/octet-stream'

/**
 * S3-совместимое хранилище. Существует не для галочки: демо-стенд живёт на эфемерной
 * файловой системе, где локальный каталог не переживает рестарт контейнера.
 */
export class S3FileStorage implements FileStorage {
  readonly #client: S3Client
  readonly #bucket: string
  readonly #keyPrefix: string
  readonly #publicBaseUrl: string | null

  constructor(options: S3FileStorageOptions) {
    this.#client = new S3Client({
      region: options.region,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      ...(options.accessKeyId === undefined || options.secretAccessKey === undefined
        ? {}
        : {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }),
    })
    this.#bucket = options.bucket
    this.#keyPrefix = options.keyPrefix ?? ''
    this.#publicBaseUrl = options.publicBaseUrl ?? null
  }

  async put(bytes: Uint8Array, mimeType: string): Promise<string> {
    const id = contentId(bytes)
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#key(id),
        Body: bytes,
        ContentType: mimeType,
        ContentLength: bytes.length,
      }),
    )
    return id
  }

  async get(id: string): Promise<StoredFile> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: this.#key(id) }),
      )
      const body = response.Body
      if (body === undefined) throw notFound(id)
      return {
        bytes: await body.transformToByteArray(),
        mimeType: response.ContentType ?? DEFAULT_MIME,
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      if (isMissing(error)) throw notFound(id, error)
      throw error
    }
  }

  url(id: string): string {
    return this.#publicBaseUrl === null
      ? `/api/files/${id}`
      : `${this.#publicBaseUrl}/${this.#key(id)}`
  }

  /** Создаёт бакет, если его нет. Нужно на локальном MinIO и на свежем стенде. */
  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }))
    } catch {
      try {
        await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }))
      } catch (error) {
        // гонка двух инстансов API на старте: бакет уже создал сосед
        if (!isAlreadyOwned(error)) throw error
      }
    }
  }

  #key(id: string): string {
    return `${this.#keyPrefix}${id}`
  }
}

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? error.name : undefined
  if (name === 'NoSuchKey' || name === 'NotFound') return true
  const metadata = '$metadata' in error ? error.$metadata : undefined
  if (typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata) {
    return (metadata as { httpStatusCode?: number }).httpStatusCode === 404
  }
  return false
}

function isAlreadyOwned(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  return error.name === 'BucketAlreadyOwnedByYou' || error.name === 'BucketAlreadyExists'
}

function notFound(id: string, cause?: unknown): DomainError {
  return new DomainError(
    'FILE_NOT_FOUND',
    `Файл «${id}» не найден`,
    cause === undefined ? undefined : { cause },
  )
}
