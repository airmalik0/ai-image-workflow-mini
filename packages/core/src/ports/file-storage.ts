export interface StoredFile {
  bytes: Uint8Array
  mimeType: string
}

/**
 * Порт файлового хранилища: локальный каталог в разработке, S3-совместимое — на стенде.
 * Идентификатор придумывает адаптер (у fs-адаптера это хеш содержимого), домен его
 * только передаёт дальше.
 *
 * `get` несуществующего файла обязан бросить `DomainError('FILE_NOT_FOUND')`,
 * а не вернуть null: пустая картинка в середине графа хуже честного падения job'а.
 */
export interface FileStorage {
  put(bytes: Uint8Array, mimeType: string): Promise<string>
  get(id: string): Promise<StoredFile>
  /** Публичный адрес файла для браузера. Синхронный: это склейка строки, а не запрос. */
  url(id: string): string
}
