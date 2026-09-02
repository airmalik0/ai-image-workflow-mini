import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileUploadResponseSchema } from '@workflow/contracts'
import { afterAll, describe, expect, it } from 'vitest'
import { encodePng } from '../db/reference-images.js'
import { FsFileStorage } from '../storage/fs-storage.js'
import { buildTestApp, buildTestDependencies } from '../testing/build-test-app.js'
import { buildApp } from '../app.js'
import { InMemoryFileCatalog } from '../testing/in-memory-file-catalog.js'
import { TINY_JPEG, buildJpeg } from '../testing/images.js'
import { multipartRequest } from '../testing/multipart.js'

const THREE_MEGABYTES = 3 * 1024 * 1024

function tinyPng(): Uint8Array {
  const rgb = new Uint8Array(4 * 4 * 3)
  for (let i = 0; i < rgb.length; i += 1) rgb[i] = (i * 7) % 256
  return encodePng(4, 4, rgb)
}

async function upload(
  app: ReturnType<typeof buildTestApp>,
  bytes: Uint8Array,
  options: { filename?: string; contentType?: string } = {},
) {
  const form = multipartRequest([
    {
      name: 'file',
      value: bytes,
      filename: options.filename ?? 'photo.jpg',
      contentType: options.contentType ?? 'image/jpeg',
    },
  ])
  return app.inject({ method: 'POST', url: '/api/files', ...form })
}

describe('загрузка и отдача файлов', () => {
  it('картинка возвращается теми же байтами и с тем же типом', async () => {
    const app = buildTestApp()

    const png = tinyPng()
    const uploaded = await upload(app, png, { filename: 'ref.png', contentType: 'image/png' })
    expect(uploaded.statusCode).toBe(201)
    const { fileId, url } = fileUploadResponseSchema.parse(uploaded.json())
    expect(url).toContain(fileId)

    const fetched = await app.inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.headers['content-type']).toBe('image/png')
    expect(new Uint8Array(fetched.rawPayload)).toEqual(png)
    await app.close()
  })

  it('фотография в 3 МБ проходит целиком: дефолтный лимит тела на неё не распространяется', async () => {
    const catalog = new InMemoryFileCatalog()
    const app = buildTestApp({ fileCatalog: catalog })

    const photo = buildJpeg(THREE_MEGABYTES)
    expect(photo.length).toBe(THREE_MEGABYTES)

    const uploaded = await upload(app, photo)
    expect(uploaded.statusCode).toBe(201)
    const { fileId } = fileUploadResponseSchema.parse(uploaded.json())

    const fetched = await app.inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.rawPayload.length).toBe(THREE_MEGABYTES)
    expect(Buffer.from(photo).equals(fetched.rawPayload)).toBe(true)
    expect(catalog.entries.get(fileId)).toMatchObject({
      mimeType: 'image/jpeg',
      sizeBytes: THREE_MEGABYTES,
      source: 'upload',
    })
    await app.close()
  })

  it('файл больше лимита — 413 с кодом в конверте, а не 500 и не обрыв', async () => {
    const app = buildTestApp({ config: { maxUploadBytes: 64 * 1024 } })

    const response = await upload(app, buildJpeg(128 * 1024))

    expect(response.statusCode).toBe(413)
    const envelope = response.json() as { error: { code: string; details: { limitBytes: number } } }
    expect(envelope.error.code).toBe('FILE_TOO_LARGE')
    // предел назван числом: без него клиент не знает, насколько уменьшать файл
    expect(envelope.error.details.limitBytes).toBe(64 * 1024)
    await app.close()
  })

  it('повторная загрузка того же файла даёт тот же идентификатор', async () => {
    const catalog = new InMemoryFileCatalog()
    const app = buildTestApp({ fileCatalog: catalog })

    const first = await upload(app, TINY_JPEG)
    const second = await upload(app, TINY_JPEG)

    expect((second.json() as { fileId: string }).fileId).toBe(
      (first.json() as { fileId: string }).fileId,
    )
    expect(catalog.entries.size).toBe(1)
    await app.close()
  })

  it('в форме нет файла — 400, а не пятисотка на разыменовании undefined', async () => {
    const app = buildTestApp()
    const form = multipartRequest([{ name: 'note', value: 'без картинки' }])

    const response = await app.inject({ method: 'POST', url: '/api/files', ...form })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('не изображение — 415: тип определяется по сигнатуре, а не по слову клиента', async () => {
    const app = buildTestApp()

    const response = await upload(app, new TextEncoder().encode('#!/bin/sh\nrm -rf /'), {
      filename: 'payload.jpg',
      contentType: 'image/jpeg',
    })

    expect(response.statusCode).toBe(415)
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    )
    await app.close()
  })

  it('запрос без multipart отклоняется, а не падает', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: { file: 'base64...' },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)
    await app.close()
  })

  it('неизвестный идентификатор — 404 FILE_NOT_FOUND', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/files/нет-такого' })

    expect(response.statusCode).toBe(404)
    expect((response.json() as { error: { code: string } }).error.code).toBe('FILE_NOT_FOUND')
    await app.close()
  })
})

describe('боевой файловый адаптер', () => {
  const directories: string[] = []

  afterAll(async () => {
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
  })

  async function appOnDisk() {
    const directory = await mkdtemp(join(tmpdir(), 'aiwf-files-'))
    directories.push(directory)
    const storage = new FsFileStorage({ dataDir: directory })
    return buildApp(buildTestDependencies({ files: storage }))
  }

  it('загруженный на диск файл отдаётся байт в байт', async () => {
    const app = await appOnDisk()

    const photo = buildJpeg(THREE_MEGABYTES)
    const uploaded = await upload(app, photo)
    const { fileId } = fileUploadResponseSchema.parse(uploaded.json())
    expect(fileId).toMatch(/^[0-9a-f]{64}$/)

    const fetched = await app.inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(Buffer.from(photo).equals(fetched.rawPayload)).toBe(true)
    await app.close()
  })

  it('попытка выйти из каталога — 404, а не чтение чужого файла', async () => {
    const app = await appOnDisk()

    const response = await app.inject({
      method: 'GET',
      url: '/api/files/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    })

    expect(response.statusCode).toBe(404)
    expect((response.json() as { error: { code: string } }).error.code).toBe('FILE_NOT_FOUND')
    await app.close()
  })
})
