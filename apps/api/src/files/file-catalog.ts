import type { Db } from '../db/client.js'
import type { FileSource } from '../db/schema.js'
import { files } from '../db/schema.js'

export interface FileCatalogEntry {
  id: string
  mimeType: string
  sizeBytes: number
  source: FileSource
}

/**
 * Учёт файлов. Байты лежат в `FileStorage`, здесь — метаданные: размер, тип
 * и происхождение. Отдельный порт, а не метод хранилища: S3 про базу ничего
 * не знает, а знать про неё ему и не надо.
 */
export interface FileCatalog {
  record(entry: FileCatalogEntry): Promise<void>
}

export class DrizzleFileCatalog implements FileCatalog {
  readonly #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /**
   * Идентификатор файла — хеш содержимого, поэтому повторная загрузка того же
   * изображения приходит с уже существующим id. Это не ошибка и не повод падать:
   * запись просто не дублируется.
   */
  async record(entry: FileCatalogEntry): Promise<void> {
    await this.#db.insert(files).values(entry).onConflictDoNothing({ target: files.id })
  }
}
