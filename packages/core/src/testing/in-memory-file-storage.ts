import { DomainError } from '../errors.js'
import type { FileStorage, StoredFile } from '../ports/file-storage.js'

/**
 * Ин-мемори файловое хранилище. Идентификатор — хеш содержимого, как у боевого
 * fs-адаптера: одинаковые байты не удваиваются, и тесты видят ту же семантику,
 * что и прод.
 */
export class InMemoryFileStorage implements FileStorage {
  readonly #files = new Map<string, StoredFile>()

  get size(): number {
    return this.#files.size
  }

  put(bytes: Uint8Array, mimeType: string): Promise<string> {
    const id = hash(bytes)
    this.#files.set(id, { bytes, mimeType })
    return Promise.resolve(id)
  }

  get(id: string): Promise<StoredFile> {
    const file = this.#files.get(id)
    if (!file) throw new DomainError('FILE_NOT_FOUND', `Файл «${id}» не найден`)
    return Promise.resolve(file)
  }

  url(id: string): string {
    return `/api/files/${id}`
  }
}

/** FNV-1a по содержимому: детерминированный идентификатор без криптографии. */
function hash(bytes: Uint8Array): string {
  let value = 0x811c9dc5
  for (const byte of bytes) {
    value ^= byte
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return `file-${value.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`
}
