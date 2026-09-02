import type { CreatePresetRequest } from '@workflow/contracts'
import type { Clock, PresetRepository } from '@workflow/core'
import { beforeEach, expect, it } from 'vitest'

/** Часы, которые двигаются на секунду за каждое обращение: порядок создания становится проверяемым. */
export function createSteppingClock(start = Date.parse('2026-09-02T09:00:00.000Z')): Clock {
  let current = start
  return {
    now: () => {
      const value = new Date(current)
      current += 1000
      return value
    },
  }
}

export const PREMIUM_3D: CreatePresetRequest = {
  name: 'Premium 3D',
  mainPrompt: 'premium minimal 3D visual, soft studio light',
  negativePrompt: 'clutter, noisy background',
  references: ['file-ref-1', 'file-ref-2'],
  defaults: { model: 'gemini-3.1-flash-image', aspectRatio: '1:1' },
}

/**
 * Поведенческий контракт `PresetRepository`, общий для ин-мемори эталона и Drizzle.
 * Главная ловушка здесь — `update`: `negativePrompt` и `defaults` обязаны различать
 * «поле не передано» и «поле передано как null», иначе первая же правка пресета
 * молча стирает негативный промпт.
 */
export function describePresetRepositoryContract(create: () => Promise<PresetRepository>): void {
  let repo: PresetRepository

  beforeEach(async () => {
    repo = await create()
  })

  it('создаёт пресет и возвращает его целиком', async () => {
    const preset = await repo.create(PREMIUM_3D)

    expect(preset.id).toBeTruthy()
    expect(preset.name).toBe('Premium 3D')
    expect(preset.negativePrompt).toBe('clutter, noisy background')
    expect(preset.references).toEqual(['file-ref-1', 'file-ref-2'])
    expect(preset.defaults).toEqual({ model: 'gemini-3.1-flash-image', aspectRatio: '1:1' })
    expect(preset.createdAt).toBe(preset.updatedAt)
    expect(await repo.findById(preset.id)).toEqual(preset)
  })

  it('допускает пресет без негативного промпта и без умолчаний', async () => {
    const preset = await repo.create({
      name: 'Голый',
      mainPrompt: 'plain',
      negativePrompt: null,
      references: [],
      defaults: null,
    })

    expect(preset.negativePrompt).toBeNull()
    expect(preset.defaults).toBeNull()
    expect(preset.references).toEqual([])
  })

  it('возвращает null по неизвестному идентификатору', async () => {
    expect(await repo.findById('preset_missing')).toBeNull()
  })

  it('перечисляет пресеты в порядке создания', async () => {
    const first = await repo.create({ ...PREMIUM_3D, name: 'Первый' })
    const second = await repo.create({ ...PREMIUM_3D, name: 'Второй' })

    expect((await repo.list()).map((preset) => preset.name)).toEqual([first.name, second.name])
  })

  it('обновляет только переданные поля и двигает updatedAt', async () => {
    const preset = await repo.create(PREMIUM_3D)
    const updated = await repo.update(preset.id, { name: 'Premium 3D v2' })

    expect(updated?.name).toBe('Premium 3D v2')
    expect(updated?.mainPrompt).toBe(PREMIUM_3D.mainPrompt)
    expect(updated?.negativePrompt).toBe(PREMIUM_3D.negativePrompt)
    expect(updated?.references).toEqual(PREMIUM_3D.references)
    expect(updated?.defaults).toEqual(PREMIUM_3D.defaults)
    expect(updated?.createdAt).toBe(preset.createdAt)
    expect(Date.parse(updated?.updatedAt ?? '')).toBeGreaterThan(Date.parse(preset.updatedAt))
  })

  it('различает «поле не передано» и «поле передано как null»', async () => {
    const preset = await repo.create(PREMIUM_3D)

    const untouched = await repo.update(preset.id, { name: 'Другое имя' })
    expect(untouched?.negativePrompt).toBe('clutter, noisy background')
    expect(untouched?.defaults).toEqual(PREMIUM_3D.defaults)

    const cleared = await repo.update(preset.id, { negativePrompt: null, defaults: null })
    expect(cleared?.negativePrompt).toBeNull()
    expect(cleared?.defaults).toBeNull()
    expect(cleared?.name).toBe('Другое имя')
  })

  it('заменяет список референсов целиком, а не дополняет его', async () => {
    const preset = await repo.create(PREMIUM_3D)
    const updated = await repo.update(preset.id, { references: ['file-ref-9'] })

    expect(updated?.references).toEqual(['file-ref-9'])
  })

  it('возвращает null при обновлении несуществующего пресета', async () => {
    expect(await repo.update('preset_missing', { name: 'x' })).toBeNull()
  })

  it('удаляет пресет и сообщает, был ли он', async () => {
    const preset = await repo.create(PREMIUM_3D)

    expect(await repo.remove(preset.id)).toBe(true)
    expect(await repo.findById(preset.id)).toBeNull()
    expect(await repo.remove(preset.id)).toBe(false)
  })
}
