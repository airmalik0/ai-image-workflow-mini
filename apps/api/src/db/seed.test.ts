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

  /*
   * Пресет описывает, ЧТО генерировать, а не ЧЕМ. Прибитая в сиде модель конкретного
   * вендора превращает каждый пресет в мину: на стенде с ключом другого провайдера
   * нода падает с VALIDATION_FAILED, хотя пользователь модель не выбирал — она
   * приехала из пресета. Проверяющий наступает на это первым же кликом.
   */
  it('ни один пресет сида не прибивает модель конкретного провайдера', () => {
    for (const preset of SEED_PRESETS) {
      expect(preset.defaults?.model, `пресет «${preset.name}»`).toBeUndefined()
    }
  })

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

  it('кладёт «Premium 3D» из ТЗ: промпты есть, вендорских настроек нет', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })

    const preset = await new DrizzlePresetRepository(testDatabase.db).findById('preset_premium_3d')

    expect(preset?.name).toBe('Premium 3D')
    expect(preset?.mainPrompt).toContain('premium minimal 3D visual')
    expect(preset?.negativePrompt).toContain('clutter')
    expect(preset?.defaults?.aspectRatio).toBe('1:1')
  })

  /*
   * Нарисованные кодом картинки боевая модель не «учитывает как стиль», а копирует:
   * с референсом-сферой вместо отредактированной фотографии приезжает сфера.
   * Поэтому к пресетам сида они не прицеплены, но в хранилище лежат готовым набором
   * для пользовательских пресетов — и обязаны оставаться настоящими PNG.
   */
  it('картинки сида лежат в хранилище настоящими PNG и ни к чему не прицеплены', async () => {
    const { database: testDatabase, storage } = await fresh()
    await seedDatabase({ db: testDatabase.db, storage })

    const presets = await new DrizzlePresetRepository(testDatabase.db).list()
    expect(presets.flatMap((preset) => preset.references)).toEqual([])

    const rows = await testDatabase.pool.query<{ id: string }>(
      "select id from files where source = 'seed'",
    )
    expect(rows.rows).toHaveLength(buildReferenceImages().length)

    for (const row of rows.rows) {
      const file = await storage.get(row.id)
      expect(file.mimeType).toBe('image/png')
      // сигнатура PNG: сид обязан класть настоящую картинку, а не заглушку
      expect([...file.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
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
