import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FsFileStorage } from '../storage/fs-storage.js'
import { DrizzlePresetRepository } from './repositories/preset.repository.js'
import { buildReferenceImages } from './reference-images.js'
import { seedDatabase, SEED_PRESETS } from './seed.js'
import type { TestDatabase } from './testing/test-database.js'
import { createTestDatabase, probeTestDatabase } from './testing/test-database.js'

const unavailable = await probeTestDatabase()

describe.skipIf(unavailable !== null)('seedDatabase', () => {
  let database: TestDatabase | null = null
  let root = ''

  beforeAll(async () => {
    database = await createTestDatabase('seed')
    root = await mkdtemp(join(tmpdir(), 'aiwf-seed-'))
  })

  afterAll(async () => {
    await database?.close()
    await rm(root, { recursive: true, force: true })
  })

  async function fresh(): Promise<{ database: TestDatabase; storage: FsFileStorage }> {
    if (database === null) throw new Error('тестовая база не поднята')
    await database.truncate()
    return { database, storage: new FsFileStorage({ dataDir: join(root, 'files') }) }
  }

  it('заводит все пресеты и все референсные картинки', async () => {
    const { database: testDatabase, storage } = await fresh()

    const result = await seedDatabase({ db: testDatabase.db, storage })

    expect(result.presetsInserted).toBe(SEED_PRESETS.length)
    expect(result.filesInserted).toBe(buildReferenceImages().length)
  })

  it('идемпотентен: повторный сид ничего не добавляет и не ломает ссылки', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })
    const before = await new DrizzlePresetRepository(testDatabase.db).list()

    const second = await seedDatabase({ db: testDatabase.db, storage })

    expect(second).toEqual({ presetsInserted: 0, filesInserted: 0 })
    expect(await new DrizzlePresetRepository(testDatabase.db).list()).toEqual(before)
  })

  it('кладёт «Premium 3D» из ТЗ с двумя рабочими референсами', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })

    const preset = await new DrizzlePresetRepository(testDatabase.db).findById('preset_premium_3d')

    expect(preset?.name).toBe('Premium 3D')
    expect(preset?.negativePrompt).toContain('clutter')
    expect(preset?.references).toHaveLength(2)
    expect(preset?.defaults?.model).toBeTruthy()

    for (const fileId of preset?.references ?? []) {
      const file = await storage.get(fileId)
      expect(file.mimeType).toBe('image/png')
      // сигнатура PNG: сид обязан класть настоящую картинку, а не заглушку
      expect([...file.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
  })

  it('все ссылки пресетов ведут в файлы, учтённые в таблице files', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })
    const presets = await new DrizzlePresetRepository(testDatabase.db).list()
    const referenced = new Set(presets.flatMap((preset) => preset.references))

    const rows = await testDatabase.pool.query<{ id: string }>(
      "select id from files where source = 'seed'",
    )
    const stored = new Set(rows.rows.map((row) => row.id))

    expect(referenced.size).toBeGreaterThan(0)
    for (const fileId of referenced) expect(stored.has(fileId)).toBe(true)
  })

  it('идентификаторы референсов детерминированы: сид на чистой машине даёт те же ссылки', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })
    const first = await new DrizzlePresetRepository(testDatabase.db).list()

    await testDatabase.truncate()
    const otherRoot = await mkdtemp(join(tmpdir(), 'aiwf-seed-other-'))
    try {
      await seedDatabase({
        db: testDatabase.db,
        storage: new FsFileStorage({ dataDir: otherRoot }),
      })
      const second = await new DrizzlePresetRepository(testDatabase.db).list()

      expect(second.map((preset) => preset.references)).toEqual(
        first.map((preset) => preset.references),
      )
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})

describe('buildReferenceImages', () => {
  it('рисует настоящие PNG заданного размера', () => {
    const images = buildReferenceImages()

    expect(images.length).toBeGreaterThanOrEqual(5)
    for (const image of images) {
      expect([...image.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(image.bytes.length).toBeGreaterThan(1000)
      // ширина и высота лежат в IHDR сразу за длиной и типом чанка
      const view = new DataView(image.bytes.buffer, image.bytes.byteOffset)
      expect(view.getUint32(16)).toBe(512)
      expect(view.getUint32(20)).toBe(512)
    }
  })

  it('детерминирован: два вызова дают байт в байт одинаковые картинки', () => {
    const first = buildReferenceImages()
    const second = buildReferenceImages()

    for (const [index, image] of first.entries()) {
      expect(Buffer.from(image.bytes).equals(Buffer.from(second[index]?.bytes ?? []))).toBe(true)
    }
  })

  it('картинки распаковываются штатным zlib и дают ожидаемое число байт', async () => {
    const { inflateSync } = await import('node:zlib')
    const image = buildReferenceImages()[0]
    if (image === undefined) throw new Error('нет ни одной картинки')

    // IDAT идёт третьим чанком: 8 байт сигнатуры + IHDR (25 байт)
    const view = new DataView(image.bytes.buffer, image.bytes.byteOffset)
    const idatLength = view.getUint32(33)
    const idat = image.bytes.subarray(41, 41 + idatLength)

    expect(inflateSync(Buffer.from(idat))).toHaveLength((512 * 3 + 1) * 512)
  })
})
