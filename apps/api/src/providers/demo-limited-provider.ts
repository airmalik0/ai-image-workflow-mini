import type { ModelDescriptor } from '@workflow/contracts'
import type {
  EditRequest,
  GenerateRequest,
  ImageProvider,
  ProviderCapabilities,
  ProviderImage,
} from '@workflow/core'
import type { DemoQuota } from './demo-quota.js'

export interface DemoLimitedProviderOptions {
  /** Боевой провайдер: пока квота не исчерпана, работает он и только он. */
  live: ImageProvider
  /** Куда стенд переключается после исчерпания квоты. */
  offline: ImageProvider
  quota: DemoQuota
}

/**
 * Предохранитель публичного демо-стенда.
 *
 * Стенд ходит в платный API по ключу владельца, поэтому у него есть дневной
 * потолок. По исчерпании потолка боевой провайдер заменяется офлайновым —
 * и замена объявляется: она видна в `GET /api/health` и показывается плашкой
 * в интерфейсе. Молча подменённый провайдер был бы обманом.
 *
 * **Подмена происходит только по исчерпанию квоты и никогда по сбою.** Ошибка
 * боевого провайдера уходит наверх как есть, при любом значении лимита. Это та
 * граница, которую нельзя размыть: замаскированный сбой ломает сценарий ТЗ
 * «нода упала → Retry», ради которого задание и написано.
 *
 * Возможности и список моделей берутся у боевого провайдера: запрос собирается
 * одинаково независимо от того, кто его в итоге исполнит, — иначе поведение
 * графа менялось бы вместе с остатком квоты.
 */
export class DemoLimitedProvider implements ImageProvider {
  readonly id: string
  readonly models: readonly ModelDescriptor[]
  readonly defaultModel: string
  readonly capabilities: ProviderCapabilities

  readonly #live: ImageProvider
  readonly #offline: ImageProvider
  readonly #quota: DemoQuota

  constructor(options: DemoLimitedProviderOptions) {
    this.#live = options.live
    this.#offline = options.offline
    this.#quota = options.quota

    this.id = options.live.id
    this.models = options.live.models
    this.defaultModel = options.live.defaultModel
    this.capabilities = options.live.capabilities
  }

  generate(req: GenerateRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#call((provider) => provider.generate(req, signal))
  }

  edit(req: EditRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#call((provider) => provider.edit(req, signal))
  }

  async #call(run: (provider: ImageProvider) => Promise<ProviderImage>): Promise<ProviderImage> {
    if ((await this.#quota.used()) >= this.#quota.limit) return run(this.#offline)

    // ошибка отсюда не перехватывается: сбой боевого провайдера обязан
    // остаться сбоем, иначе Retry нечего повторять
    const image = await run(this.#live)
    await this.#quota.record()
    return image
  }
}
