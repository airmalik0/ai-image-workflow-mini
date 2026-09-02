import type { FileCatalog, FileCatalogEntry } from '../files/file-catalog.js'

/** Ин-мемори учёт файлов для тестов роутов без базы. */
export class InMemoryFileCatalog implements FileCatalog {
  readonly entries = new Map<string, FileCatalogEntry>()

  record(entry: FileCatalogEntry): Promise<void> {
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry)
    return Promise.resolve()
  }
}
