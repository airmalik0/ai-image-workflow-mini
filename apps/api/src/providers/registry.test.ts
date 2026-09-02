import { InMemoryFileStorage } from '@workflow/core/testing'
import type { ImageProvider, ProviderImage } from '@workflow/core'
import { describe, expect, it } from 'vitest'
import { InMemoryDemoQuota } from '../testing/in-memory-demo-quota.js'
import { createProviderRegistry } from './registry.js'

const storage = new InMemoryFileStorage()

/** Генерация от имени конкретной ноды: `fake` роняет ноды по `origin.nodeId`. */
function generateFor(provider: ImageProvider, nodeId: string): Promise<ProviderImage> {
  return provider.generate(
    {
      prompt: 'кот',
      negativePrompt: null,
      references: [],
      model: null,
      aspectRatio: '1:1',
      origin: { runId: 'run-1', jobId: 'job-1', nodeId },
    },
    new AbortController().signal,
  )
}

describe('createProviderRegistry', () => {
  it('без ключей поднимается на заглушке — приложение обязано работать без AI-ключа', () => {
    const registry = createProviderRegistry({}, { storage })

    expect(registry.active.id).toBe('fake')
    expect([...registry.byId.keys()]).toEqual(['fake'])
  })

  it('auto берёт первый провайдер, для которого есть ключ', () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'auto', OPENAI_API_KEY: 'sk-test' },
      { storage },
    )

    expect(registry.active.id).toBe('openai')
    expect(registry.byId.has('fake')).toBe(true)
  })

  it('при двух ключах auto выбирает openai — он проверен вживую, у Gemini может не быть баланса', () => {
    const registry = createProviderRegistry(
      { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
      { storage },
    )

    expect(registry.active.id).toBe('openai')
    expect([...registry.byId.keys()].sort()).toEqual(['fake', 'gemini', 'openai'])
  })

  it('явно названный провайдер выбирается независимо от порядка', () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'openai', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
      { storage },
    )

    expect(registry.active.id).toBe('openai')
  })

  it('названный провайдер без ключа роняет старт, а не подменяется заглушкой', () => {
    expect(() => createProviderRegistry({ IMAGE_PROVIDER: 'gemini' }, { storage })).toThrow(
      /GEMINI_API_KEY/,
    )
  })

  it('неизвестное значение IMAGE_PROVIDER роняет старт', () => {
    expect(() => createProviderRegistry({ IMAGE_PROVIDER: 'midjourney' }, { storage })).toThrow(
      /IMAGE_PROVIDER/,
    )
  })

  it('fake выбирается явно даже при живых ключах — режим демонстрации без трат', () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'fake', GEMINI_API_KEY: 'g' },
      { storage },
    )

    expect(registry.active.id).toBe('fake')
    // боевой провайдер при этом остаётся доступным по идентификатору
    expect(registry.byId.has('gemini')).toBe(true)
  })

  it('модели всех поднятых провайдеров видны одним списком', () => {
    const registry = createProviderRegistry(
      { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
      { storage },
    )

    const providers = new Set(registry.models.map((model) => model.providerId))
    expect(providers).toEqual(new Set(['gemini', 'openai', 'fake']))
  })

  it('неверный GEMINI_IMAGE_SIZE роняет старт, а не молча отдаёт другой размер', () => {
    expect(() =>
      createProviderRegistry({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_SIZE: '8K' }, { storage }),
    ).toThrow(/GEMINI_IMAGE_SIZE/)
  })

  it('модель по умолчанию берётся из окружения', () => {
    const registry = createProviderRegistry(
      { GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-3-pro-image' },
      { storage },
    )

    expect(registry.active.defaultModel).toBe('gemini-3-pro-image')
  })

  it('FAKE_FAIL_NODES роняет названные ноды и только их', async () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'fake', FAKE_FAIL_NODES: 'generateImage-1, generateImage-3' },
      { storage },
    )

    await expect(generateFor(registry.active, 'generateImage-1')).rejects.toThrow(/generateImage-1/)
    await expect(generateFor(registry.active, 'generateImage-3')).rejects.toThrow(/generateImage-3/)
    await expect(generateFor(registry.active, 'generateImage-2')).resolves.toMatchObject({
      mimeType: 'image/png',
    })
  })

  it('FAKE_FAIL_NODES с числом попыток роняет только их: повтор доводит ноду до успеха', async () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'fake', FAKE_FAIL_NODES: 'editImage-1:1' },
      { storage },
    )

    await expect(generateFor(registry.active, 'editImage-1')).rejects.toThrow(/editImage-1/)
    await expect(generateFor(registry.active, 'editImage-1')).resolves.toMatchObject({
      mimeType: 'image/png',
    })
  })

  it('нечисловое ограничение попыток роняет старт, а не молча отключает сбой', () => {
    expect(() =>
      createProviderRegistry(
        { IMAGE_PROVIDER: 'fake', FAKE_FAIL_NODES: 'editImage-1:да' },
        {
          storage,
        },
      ),
    ).toThrow(/FAKE_FAIL_NODES/)

    expect(() =>
      createProviderRegistry(
        { IMAGE_PROVIDER: 'fake', FAKE_FAIL_NODES: 'editImage-1:0' },
        {
          storage,
        },
      ),
    ).toThrow(/FAKE_FAIL_NODES/)
  })

  it('FAKE_FAIL_NODES не трогает боевые провайдеры: сбой настраивается только у заглушки', async () => {
    const registry = createProviderRegistry(
      { IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', FAKE_FAIL_NODES: 'generateImage-1' },
      { storage, fetch: () => Promise.reject(new Error('в тесте сети нет')) },
    )

    expect(registry.active.id).toBe('gemini')

    // боевой провайдер падает своей ошибкой, а не настроенным сбоем заглушки
    const failure = await generateFor(registry.active, 'generateImage-1').catch(
      (error: unknown) => error,
    )
    expect(String(failure)).not.toMatch(/настроен ронять/)

    const fake = registry.get('fake')
    if (!fake) throw new Error('заглушка обязана быть в реестре')
    await expect(generateFor(fake, 'generateImage-1')).rejects.toThrow(/настроен ронять/)
  })

  it('без квоты предохранитель выключен и провайдеры остаются как есть', () => {
    const registry = createProviderRegistry({ OPENAI_API_KEY: 'o' }, { storage })

    expect(registry.demo).toBeNull()
    expect(registry.active).toBe(registry.get('openai'))
  })

  it('квота с нулевым потолком предохранитель не включает', () => {
    const registry = createProviderRegistry(
      { OPENAI_API_KEY: 'o' },
      { storage, demoQuota: new InMemoryDemoQuota(0) },
    )

    expect(registry.demo).toBeNull()
  })

  it('при живой квоте боевые провайдеры обёрнуты предохранителем, а заглушка — нет', async () => {
    const quota = new InMemoryDemoQuota(1)
    const registry = createProviderRegistry(
      { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
      { storage, demoQuota: quota, fetch: () => Promise.reject(new Error('в тесте сети нет')) },
    )

    expect(registry.demo).toBe(quota)
    // идентификаторы и модели не поехали: обёртка выдаёт себя за боевой провайдер
    expect(registry.active.id).toBe('openai')
    expect(new Set(registry.models.map((model) => model.providerId))).toEqual(
      new Set(['gemini', 'openai', 'fake']),
    )

    // квота исчерпана — обёрнутый провайдер отвечает картинкой заглушки, не сетью
    await quota.record()
    const image = await generateFor(registry.active, 'generateImage-1')
    expect(image.mimeType).toBe('image/png')

    // заглушка предохранителем не обёрнута: считать у неё нечего
    expect(registry.get('fake')?.id).toBe('fake')
  })

  it('get возвращает провайдер по идентификатору и undefined на неизвестном', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'g' }, { storage })

    expect(registry.get('gemini')?.id).toBe('gemini')
    expect(registry.get('midjourney')).toBeUndefined()
  })

  it('forModel отдаёт провайдера, которому принадлежит модель', () => {
    const registry = createProviderRegistry(
      { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
      { storage },
    )

    // список моделей — обещание интерфейса; каждая обязана иметь исполнителя
    for (const model of registry.models) {
      expect(registry.forModel(model.id).id).toBe(model.providerId)
    }
  })

  it('forModel без модели отдаёт активный провайдер', () => {
    const registry = createProviderRegistry({ OPENAI_API_KEY: 'o' }, { storage })

    expect(registry.forModel(null).id).toBe('openai')
  })

  it('forModel на неизвестной модели отдаёт активный, а не молча заглушку', () => {
    const registry = createProviderRegistry({ OPENAI_API_KEY: 'o' }, { storage })

    // отказ активного провайдера «такой модели нет» честнее чужой картинки
    expect(registry.forModel('midjourney-7').id).toBe('openai')
  })

  it('forModel отдаёт обёрнутый предохранителем провайдер, а не голый боевой', async () => {
    const quota = new InMemoryDemoQuota(1, 1)
    const registry = createProviderRegistry(
      { OPENAI_API_KEY: 'o' },
      { storage, demoQuota: quota, fetch: () => Promise.reject(new Error('в тесте сети нет')) },
    )

    // квота исчерпана: выбор по модели OpenAI обязан упереться в предохранитель,
    // иначе его можно обойти, ткнув в модель на ноде
    const image = await generateFor(registry.forModel('gpt-image-2'), 'generateImage-1')
    expect(image.mimeType).toBe('image/png')
  })
})
