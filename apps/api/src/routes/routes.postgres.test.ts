import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileUploadResponseSchema, presetSchema, workflowSchema } from '@workflow/contracts'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { DrizzlePresetRepository } from '../db/repositories/preset.repository.js'
import { DrizzleRunRepository } from '../db/repositories/run.repository.js'
import { DrizzleWorkflowRepository } from '../db/repositories/workflow.repository.js'
import type { TestDatabase } from '../db/testing/test-database.js'
import { createTestDatabase, probeTestDatabase } from '../db/testing/test-database.js'
import { DrizzleFileCatalog } from '../files/file-catalog.js'
import { files } from '../db/schema.js'
import { FsFileStorage } from '../storage/fs-storage.js'
import { buildTestDependencies } from '../testing/build-test-app.js'
import { TINY_JPEG, buildJpeg } from '../testing/images.js'
import { multipartRequest } from '../testing/multipart.js'

const unavailable = await probeTestDatabase()

/**
 * Те же роуты, но на боевых адаптерах. Ин-мемори репозитории отвечают структурами
 * домена, Drizzle — строками из Postgres, и расхождение видно только здесь:
 * `timestamptz` приезжает объектом `Date`, а контракт требует строку ISO.
 * Тест ловит именно это — сериализацию ответа, а не логику репозитория.
 */
describe.skipIf(unavailable !== null)('REST на живом Postgres', () => {
  let database: TestDatabase | null = null
  let directory: string | null = null
  let app: FastifyInstance | null = null

  beforeAll(async () => {
    database = await createTestDatabase('routes')
    directory = await mkdtemp(join(tmpdir(), 'aiwf-routes-'))
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
    if (directory !== null) await rm(directory, { recursive: true, force: true })
  })

  beforeEach(async () => {
    if (database === null || directory === null) throw new Error('стенд не поднят')
    await database.truncate()
    await app?.close()

    const storage = new FsFileStorage({ dataDir: directory })
    app = buildApp(
      buildTestDependencies({
        presets: new DrizzlePresetRepository(database.db),
        workflows: new DrizzleWorkflowRepository(database.db),
        runs: new DrizzleRunRepository(database.db),
        files: storage,
        fileCatalog: new DrizzleFileCatalog(database.db),
        database: async () => {
          await database?.pool.query('select 1')
          return true
        },
      }),
    )
  })

  function server(): FastifyInstance {
    if (app === null) throw new Error('приложение не собрано')
    return app
  }

  it('пресет проходит полный цикл и отдаётся строками ISO, а не объектами Date', async () => {
    const created = await server().inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'На постгресе', mainPrompt: 'studio light' },
    })

    expect(created.statusCode).toBe(201)
    const preset = presetSchema.parse(created.json())
    expect(typeof (created.json() as { createdAt: unknown }).createdAt).toBe('string')

    const patched = await server().inject({
      method: 'PATCH',
      url: `/api/presets/${preset.id}`,
      payload: { references: ['a', 'b'] },
    })
    expect(presetSchema.parse(patched.json()).references).toEqual(['a', 'b'])

    const removed = await server().inject({ method: 'DELETE', url: `/api/presets/${preset.id}` })
    expect(removed.statusCode).toBe(204)
  })

  it('граф сохраняется в jsonb и возвращается без потерь', async () => {
    const graph = {
      nodes: [
        { id: 'p1', kind: 'prompt' as const, position: { x: 1.5, y: -2 }, data: { text: 'кот' } },
      ],
      edges: [],
    }

    const created = await server().inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Из базы', graph },
    })

    expect(created.statusCode).toBe(201)
    expect(workflowSchema.parse(created.json()).graph).toEqual(graph)
  })

  it('загрузка пишет метаданные в таблицу files, повторная не дублирует строку', async () => {
    const form = multipartRequest([
      {
        name: 'file',
        value: buildJpeg(3 * 1024 * 1024),
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      },
    ])

    const first = await server().inject({ method: 'POST', url: '/api/files', ...form })
    expect(first.statusCode).toBe(201)
    const { fileId } = fileUploadResponseSchema.parse(first.json())

    const again = multipartRequest([
      {
        name: 'file',
        value: buildJpeg(3 * 1024 * 1024),
        filename: 'снова.jpg',
        contentType: 'image/jpeg',
      },
    ])
    const second = await server().inject({ method: 'POST', url: '/api/files', ...again })
    expect(fileUploadResponseSchema.parse(second.json()).fileId).toBe(fileId)

    if (database === null) throw new Error('база не поднята')
    const rows = await database.db.select().from(files)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: fileId,
      mimeType: 'image/jpeg',
      sizeBytes: 3 * 1024 * 1024,
      source: 'upload',
    })

    const fetched = await server().inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(fetched.rawPayload.length).toBe(3 * 1024 * 1024)
  })

  it('маленький файл тоже доезжает и отдаётся тем же типом', async () => {
    const form = multipartRequest([
      { name: 'file', value: TINY_JPEG, filename: 'tiny.jpg', contentType: 'image/jpeg' },
    ])

    const uploaded = await server().inject({ method: 'POST', url: '/api/files', ...form })
    const { fileId } = fileUploadResponseSchema.parse(uploaded.json())

    const fetched = await server().inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(fetched.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.from(TINY_JPEG).equals(fetched.rawPayload)).toBe(true)
  })

  it('health на живой базе — ok', async () => {
    const response = await server().inject({ method: 'GET', url: '/api/health' })

    expect(response.json()).toMatchObject({ status: 'ok', database: 'up' })
  })
})
