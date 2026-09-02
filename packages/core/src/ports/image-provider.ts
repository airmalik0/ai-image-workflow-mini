import type { ModelDescriptor } from '@workflow/contracts'

/**
 * Ссылка на изображение в FileStorage. Ядро байтами не оперирует: и пресет,
 * и выход предыдущей ноды — это идентификаторы файлов. Байты по идентификатору
 * поднимает сам адаптер провайдера, у которого есть доступ к хранилищу.
 */
export interface ImageRef {
  fileId: string
}

/**
 * Кто именно делает запрос. Провайдеру для генерации это не нужно — поле служит
 * корреляции логов с job'ом и детерминированному поведению fake-провайдера в тестах.
 */
export interface RequestOrigin {
  runId: string
  jobId: string
  nodeId: string
}

export interface GenerateRequest {
  prompt: string
  /**
   * Негатив отдельным полем — только если провайдер его понимает. Если нет,
   * RequestBuilder вклеивает его в `prompt`, а сюда кладёт null: у Gemini,
   * например, поля `negativePrompt` в API просто не существует.
   */
  negativePrompt: string | null
  /** Референсы пресета, уже обрезанные до лимита провайдера. */
  references: ImageRef[]
  /** null — «модель не выбрана», адаптер подставит свой `defaultModel`. */
  model: string | null
  aspectRatio: string
  origin?: RequestOrigin
}

export interface EditRequest extends GenerateRequest {
  image: ImageRef
}

export interface ProviderImage {
  bytes: Uint8Array
  mimeType: string
  /** Модель, которая реально выполнила запрос: `model: null` в запросе разрешается адаптером. */
  model: string
  meta: Record<string, unknown>
}

/**
 * Что провайдер умеет. RequestBuilder читает эту таблицу, чтобы собрать запрос
 * под конкретный движок, а не подгонять код под частный случай одного вендора.
 */
export interface ProviderCapabilities {
  edit: boolean
  /** Сколько референсных изображений принимает; 0 — не поддерживает вовсе. */
  referenceImages: number
  negativePrompt: boolean
  /** Допустимые пропорции. Пустой список — провайдер не ограничивает. */
  aspectRatio: readonly string[]
}

/**
 * Порт генерации изображений. Реализации живут в приложениях (`gemini`, `fake`),
 * ядро знает только этот интерфейс — поэтому смена движка не трогает домен.
 *
 * `signal` обязателен и обязан доводиться до реального запроса: отмена run'а
 * должна прерывать уже начатую генерацию, а не только снимать очередь.
 */
export interface ImageProvider {
  readonly id: string
  readonly models: readonly ModelDescriptor[]
  /** Чем работать, если модель в запросе не указана. */
  readonly defaultModel: string
  readonly capabilities: ProviderCapabilities
  generate(req: GenerateRequest, signal: AbortSignal): Promise<ProviderImage>
  edit(req: EditRequest, signal: AbortSignal): Promise<ProviderImage>
}
