import type { Preset } from '@workflow/contracts'
import { expect, it } from 'vitest'
import { buildProviderRequest } from './request-builder.js'

// даты добавлены к пресету из плана: без них литерал не является Preset,
// а спред `{ ...preset }` в тесте про лимит референсов не компилируется
const preset = {
  id: 'p1',
  name: 'Premium 3D',
  mainPrompt: 'premium minimal 3D visual',
  negativePrompt: 'clutter, noisy background',
  references: ['ref-1', 'ref-2'],
  defaults: { model: 'model-a', aspectRatio: '3:4' },
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} satisfies Preset

const caps = { edit: true, referenceImages: 4, negativePrompt: true, aspectRatio: ['1:1', '3:4'] }

it('склеивает промпт пресета с пользовательским, пресет впереди', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка на столе',
    preset,
    params: {} as never,
    capabilities: caps,
  })
  expect(req.prompt).toBe('premium minimal 3D visual, кружка на столе')
})

it('без пресета отдаёт только пользовательский промпт', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка',
    preset: null,
    params: {} as never,
    capabilities: caps,
  })
  expect(req.prompt).toBe('кружка')
  expect(req.negativePrompt).toBeNull()
  expect(req.references).toEqual([])
})

it('параметры ноды перекрывают defaults пресета', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка',
    preset,
    params: { aspectRatio: '1:1' } as never,
    capabilities: caps,
  })
  expect(req.aspectRatio).toBe('1:1')
  expect(req.model).toBe('model-a')
})

it('если провайдер не умеет negativePrompt — вклеивает его в промпт', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка',
    preset,
    params: {} as never,
    capabilities: { ...caps, negativePrompt: false },
  })
  expect(req.negativePrompt).toBeNull()
  expect(req.prompt).toContain('The scene must not contain: clutter, noisy background')
})

it('обрезает референсы до лимита провайдера', () => {
  const many = { ...preset, references: ['a', 'b', 'c', 'd', 'e'] } as never
  const req = buildProviderRequest({
    userPrompt: 'x',
    preset: many,
    params: {} as never,
    capabilities: { ...caps, referenceImages: 2 },
  })
  expect(req.references).toHaveLength(2)
})

it('пустой пользовательский промпт при непустом пресете допустим', () => {
  const req = buildProviderRequest({
    userPrompt: '',
    preset,
    params: {} as never,
    capabilities: caps,
  })
  expect(req.prompt).toBe('premium minimal 3D visual')
})
