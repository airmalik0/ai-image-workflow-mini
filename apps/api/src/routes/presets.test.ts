import { errorEnvelopeSchema, presetSchema } from '@workflow/contracts'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/build-test-app.js'

const body = {
  name: 'Ночной неон',
  mainPrompt: 'neon city at night, wet asphalt reflections',
  negativePrompt: 'daylight, text, watermark',
  references: ['file-1'],
  defaults: { model: 'gemini-3.1-flash-image', aspectRatio: '16:9' },
}

describe('CRUD пресетов', () => {
  it('созданный пресет возвращается списком и по идентификатору', async () => {
    const app = buildTestApp()

    const created = await app.inject({ method: 'POST', url: '/api/presets', payload: body })
    expect(created.statusCode).toBe(201)
    const preset = presetSchema.parse(created.json())
    expect(preset).toMatchObject({ name: 'Ночной неон', references: ['file-1'] })

    const one = await app.inject({ method: 'GET', url: `/api/presets/${preset.id}` })
    expect(one.statusCode).toBe(200)
    expect(one.json()).toEqual(preset)

    const list = await app.inject({ method: 'GET', url: '/api/presets' })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual([preset])
    await app.close()
  })

  it('необязательные поля получают значения по умолчанию из контракта', async () => {
    const app = buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Минимальный', mainPrompt: 'plain' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      negativePrompt: null,
      references: [],
      defaults: null,
    })
    await app.close()
  })

  it('тело не по схеме — 400 в конверте с перечнем проблем, а не 500', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: '', mainPrompt: 'x' },
    })

    expect(response.statusCode).toBe(400)
    const envelope = errorEnvelopeSchema.parse(response.json())
    expect(envelope.error.code).toBe('VALIDATION_FAILED')
    expect(JSON.stringify(envelope.error.details)).toContain('name')
    await app.close()
  })

  it('PATCH меняет переданное и обнуляет явным null, не трогая остальное', async () => {
    const app = buildTestApp()
    const created = await app.inject({ method: 'POST', url: '/api/presets', payload: body })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/presets/${(created.json() as { id: string }).id}`,
      payload: { negativePrompt: null },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      name: 'Ночной неон',
      mainPrompt: body.mainPrompt,
      negativePrompt: null,
    })
    await app.close()
  })

  it('удаление отдаёт 204, повторное — 404 с кодом PRESET_NOT_FOUND', async () => {
    const app = buildTestApp()
    const created = await app.inject({ method: 'POST', url: '/api/presets', payload: body })
    const url = `/api/presets/${(created.json() as { id: string }).id}`

    const removed = await app.inject({ method: 'DELETE', url })
    expect(removed.statusCode).toBe(204)
    expect(removed.body).toBe('')

    const again = await app.inject({ method: 'DELETE', url })
    expect(again.statusCode).toBe(404)
    expect((again.json() as { error: { code: string } }).error.code).toBe('PRESET_NOT_FOUND')
    await app.close()
  })

  it('чтение и правка несуществующего пресета — 404, а не пустой ответ', async () => {
    const app = buildTestApp()

    const read = await app.inject({ method: 'GET', url: '/api/presets/нет-такого' })
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/presets/нет-такого',
      payload: { name: 'x' },
    })

    expect(read.statusCode).toBe(404)
    expect(patched.statusCode).toBe(404)
    await app.close()
  })
})
