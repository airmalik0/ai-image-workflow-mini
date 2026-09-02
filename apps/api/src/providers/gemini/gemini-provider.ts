import type { ModelDescriptor } from '@workflow/contracts'
import { ProviderError } from '@workflow/core'
import type {
  EditRequest,
  FileStorage,
  GenerateRequest,
  ImageProvider,
  ImageRef,
  ProviderCapabilities,
  ProviderImage,
} from '@workflow/core'
import { decodeBase64, encodeBase64 } from '../bytes.js'
import type { FetchLike } from '../http.js'
import { requestJson } from '../http.js'
import { readArray, readString, readValue } from '../json.js'
import { mapGeminiHttpError, mapGeminiMissingImage } from './error-mapping.js'
import type { GeminiImageSize, GeminiModelSpec } from './models.js'
import { DEFAULT_GEMINI_MODEL, findGeminiModel, GEMINI_MODELS } from './models.js'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Худшая наблюдавшаяся генерация — 38 с (3-pro @ 4K), поэтому запас двукратный.
 * Один таймаут на все размеры был бы либо слишком коротким для 4K, либо слишком
 * длинным для 1K: полторы минуты ожидания ошибки — это полторы минуты занятого
 * слота конкурентности.
 */
const TIMEOUT_MS: Record<GeminiImageSize, number> = {
  '512': 90_000,
  '1K': 90_000,
  '2K': 180_000,
  '4K': 180_000,
}

/**
 * Сверх 5–6 картинок модель начинает терять детали (проверено на живых запросах),
 * хотя API принимает и двести. Ограничение — про качество, а не про протокол;
 * лишние референсы обрезает `RequestBuilder` по этому числу.
 */
const MAX_REFERENCE_IMAGES = 6

export interface GeminiProviderOptions {
  apiKey: string
  /** Референсы и исходник редактирования приходят идентификаторами файлов — байты поднимает адаптер. */
  storage: FileStorage
  /** Модель по умолчанию, если нода её не выбрала. */
  model?: string
  imageSize?: GeminiImageSize
  baseUrl?: string
  fetch?: FetchLike
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/**
 * Адаптер Gemini на голом `fetch`.
 *
 * SDK `@google/genai` сознательно не взят: 29 МБ зависимостей ради одного POST'а,
 * ретраи по умолчанию выключены, `httpOptions.timeout` мутирует глобальный
 * undici-диспетчер процесса, а гугловый JSON ошибки завёрнут в `message` строкой —
 * структурный разбор всё равно писать руками. Обоснование целиком —
 * в `docs/research/gemini-api.md`, §10.
 */
export class GeminiProvider implements ImageProvider {
  readonly id = 'gemini'
  readonly models: readonly ModelDescriptor[] = GEMINI_MODELS.map((model) => ({
    id: model.id,
    providerId: 'gemini',
    label: model.label,
    supportsEdit: model.supportsEdit,
  }))

  readonly defaultModel: string
  readonly capabilities: ProviderCapabilities

  readonly #apiKey: string
  readonly #storage: FileStorage
  readonly #baseUrl: string
  readonly #fetch: FetchLike
  readonly #imageSize: GeminiImageSize
  readonly #defaultSpec: GeminiModelSpec

  constructor(options: GeminiProviderOptions) {
    const modelId = options.model ?? DEFAULT_GEMINI_MODEL
    const spec = findGeminiModel(modelId)
    if (!spec) {
      throw new ProviderError(
        'VALIDATION_FAILED',
        `Gemini: неизвестная модель по умолчанию «${modelId}»`,
        false,
      )
    }

    this.#apiKey = options.apiKey
    this.#storage = options.storage
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.#imageSize = options.imageSize ?? '1K'
    this.#defaultSpec = spec
    this.defaultModel = spec.id
    this.capabilities = {
      edit: spec.supportsEdit,
      referenceImages: MAX_REFERENCE_IMAGES,
      // поля negativePrompt у API нет вовсе — подтверждено discovery-документом
      negativePrompt: false,
      aspectRatio: spec.aspectRatios,
    }
  }

  generate(req: GenerateRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#run(req, null, signal)
  }

  edit(req: EditRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#run(req, req.image, signal)
  }

  async #run(
    req: GenerateRequest,
    source: ImageRef | null,
    signal: AbortSignal,
  ): Promise<ProviderImage> {
    const spec = this.#resolveModel(req.model)
    const prompt = req.prompt.trim()
    if (prompt.length === 0) {
      // пустой промпт API принимает и отвечает HTTP 200 с finishReason NO_IMAGE —
      // дешевле и понятнее отсечь его здесь
      throw invalid('Gemini: пустой промпт — нечего генерировать')
    }

    const parts: GeminiPart[] = []
    if (source) parts.push(await this.#imagePart(source))
    for (const reference of req.references) parts.push(await this.#imagePart(reference))
    parts.push({ text: prompt })

    const generationConfig = source
      ? // при редактировании аспект и размер наследуются от входной картинки:
        // навязанный 1:1 перекадрировал бы исходник, чего пользователь не просил
        { responseModalities: ['IMAGE'] }
      : {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: this.#checkAspectRatio(spec, req.aspectRatio),
            imageSize: this.#checkImageSize(spec),
          },
        }

    const result = await requestJson(
      this.#fetch,
      `${this.#baseUrl}/models/${spec.id}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.#apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      },
      { timeoutMs: TIMEOUT_MS[this.#imageSize], signal, label: 'Gemini' },
    )

    if (!result.ok) throw mapGeminiHttpError(result.status, result.body)
    return this.#readImage(result.body, spec)
  }

  /**
   * Успешный HTTP — ещё не картинка. Ищем `inlineData` перебором партов:
   * без `responseModalities` модель кладёт перед картинкой текстовый парт,
   * а при отказе не кладёт картинку вовсе, оставляя HTTP 200.
   */
  #readImage(body: unknown, spec: GeminiModelSpec): ProviderImage {
    const candidate = readArray(body, 'candidates')[0]
    const inline = readArray(candidate, 'content', 'parts')
      .map((part) => readValue(part, 'inlineData'))
      .find((data) => readString(data, 'data') !== null)

    const data = readString(inline, 'data')
    if (data === null) throw mapGeminiMissingImage(candidate)

    return {
      bytes: decodeBase64(data),
      // 2.5-flash отдаёт PNG, все gemini-3 — JPEG; тип берём из ответа, а не угадываем
      mimeType: readString(inline, 'mimeType') ?? 'image/png',
      model: readString(body, 'modelVersion') ?? spec.id,
      meta: {
        finishReason: readString(candidate, 'finishReason'),
        responseId: readString(body, 'responseId'),
        usage: readValue(body, 'usageMetadata'),
        imageSize: this.#imageSize,
      },
    }
  }

  async #imagePart(ref: ImageRef): Promise<GeminiPart> {
    const file = await this.#storage.get(ref.fileId)
    return { inlineData: { mimeType: file.mimeType, data: encodeBase64(file.bytes) } }
  }

  #resolveModel(requested: string | null): GeminiModelSpec {
    if (requested === null) return this.#defaultSpec
    const spec = findGeminiModel(requested)
    if (spec) return spec
    throw invalid(
      `Gemini: модель «${requested}» не поддерживается. Доступны: ${GEMINI_MODELS.map((model) => model.id).join(', ')}`,
    )
  }

  #checkAspectRatio(spec: GeminiModelSpec, aspectRatio: string): string {
    if (spec.aspectRatios.includes(aspectRatio)) return aspectRatio
    throw invalid(
      `Gemini: модель «${spec.id}» не поддерживает пропорции ${aspectRatio}. Доступны: ${spec.aspectRatios.join(', ')}`,
    )
  }

  #checkImageSize(spec: GeminiModelSpec): GeminiImageSize {
    if (spec.imageSizes.includes(this.#imageSize)) return this.#imageSize
    throw invalid(
      `Gemini: модель «${spec.id}» не поддерживает размер ${this.#imageSize}. Доступны: ${spec.imageSizes.join(', ')}`,
    )
  }
}

function invalid(message: string): ProviderError {
  return new ProviderError('VALIDATION_FAILED', message, false)
}
