import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileStorage, StoredFile } from '@workflow/core'
import { DomainError } from '@workflow/core'

export interface FsFileStorageOptions {
  /** Каталог с файлами. В Docker — том, чтобы результаты переживали рестарт. */
  dataDir: string
  /** База публичного адреса. По умолчанию файлы отдаёт сам API. */
  // `| undefined` здесь не украшение: при exactOptionalPropertyTypes тип,
  // выведенный zod из `.optional()`, иначе не присваивается
  publicBaseUrl?: string | undefined
}

const DEFAULT_MIME = 'application/octet-stream'

/**
 * Имя файла — SHA-256 его содержимого. Отсюда два бесплатных свойства:
 * одинаковые байты не хранятся дважды, а повторная загрузка идемпотентна.
 *
 * Идентификатор приходит в `GET /api/files/:id` прямо из URL, поэтому он
 * проверяется регуляркой, а не «очищается»: любая попытка нормализовать
 * путь — это соревнование с изобретательностью атакующего, а фиксированный
 * алфавит из шестнадцатеричных цифр не оставляет места для «../».
 */
const FILE_ID = /^[0-9a-f]{64}$/

export class FsFileStorage implements FileStorage {
  readonly #dataDir: string
  readonly #publicBaseUrl: string

  constructor(options: FsFileStorageOptions) {
    this.#dataDir = options.dataDir
    this.#publicBaseUrl = options.publicBaseUrl ?? '/api/files'
  }

  async put(bytes: Uint8Array, mimeType: string): Promise<string> {
    const id = contentId(bytes)
    await mkdir(this.#dataDir, { recursive: true })
    await this.#writeAtomically(id, bytes)
    await this.#writeAtomically(
      `${id}.meta.json`,
      new TextEncoder().encode(JSON.stringify({ mimeType, size: bytes.length })),
    )
    return id
  }

  async get(id: string): Promise<StoredFile> {
    if (!FILE_ID.test(id)) throw notFound(id)

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(join(this.#dataDir, id)))
    } catch (error) {
      throw notFound(id, error)
    }

    return { bytes, mimeType: await this.#readMimeType(id) }
  }

  url(id: string): string {
    return `${this.#publicBaseUrl}/${id}`
  }

  /**
   * Запись во временный файл и `rename`. Без этого параллельные `put` одного
   * содержимого могут дать читателю полуфайл: `writeFile` не атомарен,
   * а идентификатор у обоих писателей один и тот же.
   */
  async #writeAtomically(name: string, bytes: Uint8Array): Promise<void> {
    const target = join(this.#dataDir, name)
    const temporary = `${target}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async #readMimeType(id: string): Promise<string> {
    try {
      const raw = await readFile(join(this.#dataDir, `${id}.meta.json`), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && 'mimeType' in parsed) {
        const value = (parsed as { mimeType: unknown }).mimeType
        if (typeof value === 'string' && value.length > 0) return value
      }
      return DEFAULT_MIME
    } catch {
      // метаданные потерялись, а байты на месте: отдать файл важнее, чем угадать тип
      return DEFAULT_MIME
    }
  }
}

export function contentId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function notFound(id: string, cause?: unknown): DomainError {
  return new DomainError(
    'FILE_NOT_FOUND',
    `Файл «${id}» не найден`,
    cause === undefined ? undefined : { cause },
  )
}
