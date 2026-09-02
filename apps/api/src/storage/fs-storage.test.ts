import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomainError } from '@workflow/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsFileStorage } from './fs-storage.js'

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('FsFileStorage', () => {
  let root = ''
  let storage: FsFileStorage

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aiwf-files-'))
    storage = new FsFileStorage({ dataDir: join(root, 'files') })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('возвращает те же байты и тот же mimeType', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')
    const file = await storage.get(id)

    expect(file.bytes).toEqual(PNG_HEADER)
    expect(file.mimeType).toBe('image/png')
  })

  it('создаёт каталог хранилища сам, если его ещё нет', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')

    expect(await readdir(join(root, 'files'))).toContain(id)
  })

  it('даёт одинаковым байтам одинаковый идентификатор и не удваивает файл', async () => {
    const first = await storage.put(PNG_HEADER, 'image/png')
    const second = await storage.put(Uint8Array.from(PNG_HEADER), 'image/png')

    expect(second).toBe(first)
    const entries = await readdir(join(root, 'files'))
    expect(entries.filter((entry) => entry.startsWith(first))).toHaveLength(2) // байты + метаданные
  })

  it('разным байтам даёт разные идентификаторы', async () => {
    const first = await storage.put(Uint8Array.from([1, 2, 3]), 'application/octet-stream')
    const second = await storage.put(Uint8Array.from([1, 2, 4]), 'application/octet-stream')

    expect(second).not.toBe(first)
  })

  it('на неизвестный файл бросает FILE_NOT_FOUND, а не возвращает пустоту', async () => {
    await expect(storage.get('0'.repeat(64))).rejects.toBeInstanceOf(DomainError)
    await expect(storage.get('0'.repeat(64))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  it('не выпускает чтение за пределы каталога данных', async () => {
    // идентификатор приходит прямо из URL `GET /api/files/:id`, и «../» в нём —
    // это не теория, а первое, что пробует любой сканер
    const secret = join(root, 'secret.txt')
    await writeFile(secret, 'пароль')

    await expect(storage.get('../secret.txt')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(storage.get('/etc/passwd')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(storage.get('..%2Fsecret.txt')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  it('переживает файл реального размера, а не иконку', async () => {
    // 3 МБ — обычная фотография с телефона; на ней ломаются реализации,
    // рассчитанные на «картинку в тесте» размером в килобайт
    const big = new Uint8Array(3 * 1024 * 1024)
    for (let index = 0; index < big.length; index += 1) big[index] = index % 251

    const id = await storage.put(big, 'image/jpeg')
    const file = await storage.get(id)

    expect(file.bytes).toHaveLength(big.length)
    // побайтовое сравнение через Buffer, а не через toEqual: на трёх миллионах
    // элементов глубокое сравнение vitest занимает больше, чем весь остальной прогон
    expect(Buffer.from(file.bytes).equals(Buffer.from(big))).toBe(true)
    expect(file.mimeType).toBe('image/jpeg')
  })

  it('выдерживает одновременную запись одного и того же содержимого', async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => storage.put(PNG_HEADER, 'image/png')),
    )

    expect(new Set(ids).size).toBe(1)
    const file = await storage.get(ids[0] ?? '')
    expect(file.bytes).toEqual(PNG_HEADER)
  })

  it('не оставляет временных файлов после записи', async () => {
    await storage.put(PNG_HEADER, 'image/png')

    expect((await readdir(join(root, 'files'))).some((entry) => entry.includes('.tmp'))).toBe(false)
  })

  it('отдаёт публичный адрес файла для браузера', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')

    expect(storage.url(id)).toBe(`/api/files/${id}`)
    expect(
      new FsFileStorage({ dataDir: root, publicBaseUrl: 'https://cdn.example/f' }).url(id),
    ).toBe(`https://cdn.example/f/${id}`)
  })

  it('переживает потерю файла с метаданными', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')
    await rm(join(root, 'files', `${id}.meta.json`))

    const file = await storage.get(id)

    expect(file.bytes).toEqual(PNG_HEADER)
    expect(file.mimeType).toBe('application/octet-stream')
  })

  it('кладёт байты как есть, без обёрток и кодирования', async () => {
    const id = await storage.put(PNG_HEADER, 'image/png')

    expect(new Uint8Array(await readFile(join(root, 'files', id)))).toEqual(PNG_HEADER)
  })
})
