import { ProviderError } from '@workflow/core'
import type { EditRequest, GenerateRequest, ImageProvider, ProviderImage } from '@workflow/core'
import { describe, expect, it } from 'vitest'
import { InMemoryDemoQuota } from '../testing/in-memory-demo-quota.js'
import { DemoLimitedProvider } from './demo-limited-provider.js'

/** Провайдер-счётчик: важно не что он рисует, а сколько раз его позвали. */
class StubProvider implements ImageProvider {
  readonly models = [
    { id: 'stub-1', providerId: 'stub', label: 'Stub', supportsEdit: true },
  ] as const

  readonly defaultModel = 'stub-1'
  readonly capabilities = {
    edit: true,
    referenceImages: 2,
    negativePrompt: false,
    aspectRatio: ['1:1'],
  } as const

  calls = 0
  edits = 0

  constructor(
    readonly id: string,
    private readonly failure: Error | null = null,
  ) {}

  generate(): Promise<ProviderImage> {
    this.calls += 1
    if (this.failure) return Promise.reject(this.failure)
    return Promise.resolve(this.#image())
  }

  edit(): Promise<ProviderImage> {
    this.edits += 1
    if (this.failure) return Promise.reject(this.failure)
    return Promise.resolve(this.#image())
  }

  #image(): ProviderImage {
    return {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      model: this.defaultModel,
      meta: { provider: this.id },
    }
  }
}

const request: GenerateRequest = {
  prompt: 'кот',
  negativePrompt: null,
  references: [],
  model: null,
  aspectRatio: '1:1',
}

const editRequest: EditRequest = { ...request, image: { fileId: 'file-1' } }

const signal = () => new AbortController().signal

const guarded = (live: ImageProvider, offline: ImageProvider, quota: InMemoryDemoQuota) =>
  new DemoLimitedProvider({ live, offline, quota })

describe('DemoLimitedProvider', () => {
  it('пока квота не исчерпана, работает боевой провайдер, а расход растёт', async () => {
    const live = new StubProvider('openai')
    const offline = new StubProvider('fake')
    const quota = new InMemoryDemoQuota(2)

    const image = await guarded(live, offline, quota).generate(request, signal())

    expect(image.meta).toEqual({ provider: 'openai' })
    expect(offline.calls).toBe(0)
    expect(await quota.used()).toBe(1)
  })

  it('по исчерпании квоты отвечает заглушка, а боевой провайдер не вызывается', async () => {
    const live = new StubProvider('openai')
    const offline = new StubProvider('fake')
    const quota = new InMemoryDemoQuota(1, 1)

    const image = await guarded(live, offline, quota).generate(request, signal())

    expect(image.meta).toEqual({ provider: 'fake' })
    expect(live.calls).toBe(0)
    // офлайновая генерация бесплатна и в счётчик не идёт
    expect(await quota.used()).toBe(1)
  })

  it('редактирование считается по той же квоте', async () => {
    const live = new StubProvider('openai')
    const offline = new StubProvider('fake')
    const quota = new InMemoryDemoQuota(1)
    const provider = guarded(live, offline, quota)

    await provider.edit(editRequest, signal())
    const second = await provider.edit(editRequest, signal())

    expect(live.edits).toBe(1)
    expect(second.meta).toEqual({ provider: 'fake' })
  })

  it('ошибка боевого провайдера остаётся ошибкой и не подменяется заглушкой', async () => {
    const failure = new ProviderError('PROVIDER_UNAVAILABLE', 'провайдер лежит', true)
    const live = new StubProvider('openai', failure)
    const offline = new StubProvider('fake')
    const quota = new InMemoryDemoQuota(10)

    await expect(guarded(live, offline, quota).generate(request, signal())).rejects.toThrow(
      'провайдер лежит',
    )
    // заглушка не подхватывает упавший запрос, и неудача квоту не тратит
    expect(offline.calls).toBe(0)
    expect(await quota.used()).toBe(0)
  })

  it('ошибка не подменяется и на последней единице квоты — граница именно по квоте, не по сбою', async () => {
    const failure = new ProviderError('PROVIDER_SAFETY_BLOCKED', 'запрос отклонён', false)
    const live = new StubProvider('openai', failure)
    const offline = new StubProvider('fake')
    const quota = new InMemoryDemoQuota(3, 2)

    await expect(guarded(live, offline, quota).generate(request, signal())).rejects.toThrow(
      'запрос отклонён',
    )
    expect(offline.calls).toBe(0)
  })

  it('возможности и модели показываются боевого провайдера: запрос собирается одинаково', () => {
    const live = new StubProvider('openai')
    const offline = new StubProvider('fake')
    const provider = guarded(live, offline, new InMemoryDemoQuota(1))

    expect(provider.id).toBe('openai')
    expect(provider.defaultModel).toBe('stub-1')
    expect(provider.capabilities).toEqual(live.capabilities)
    expect(provider.models).toEqual(live.models)
  })
})
