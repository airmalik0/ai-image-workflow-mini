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
import { decodeBase64, sniffImageMime } from '../bytes.js'
import type { FetchLike } from '../http.js'
import { requestJson } from '../http.js'
import { readArray, readString, readValue } from '../json.js'
import { mapOpenAiHttpError } from './error-mapping.js'
import type { OpenAiModelSpec } from './models.js'
import { DEFAULT_OPENAI_MODEL, findOpenAiModel, OPENAI_MODELS } from './models.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** Редактирование 1024×1024 занимает 17–19 с; запас взят с шестикратным перекрытием. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Живьём проверено два референса одним запросом; поле `image[]` повторяется
 * без явного лимита. Четыре — осознанный потолок: больше картинок модель
 * смешивает всё хуже, а платим мы за каждую входную.
 */
const MAX_REFERENCE_IMAGES = 4

export interface OpenAiProviderOptions {
  apiKey: string
  storage: FileStorage
  model?: string
  baseUrl?: string
  fetch?: FetchLike
  timeoutMs?: number
}

/**
 * Адаптер OpenAI Images на голом `fetch`.
 *
 * Пакет `openai` не взят по той же причине, что и SDK Gemini: ради двух POST'ов
 * он тянет зависимость с собственной политикой ретраев и таймаутов, а разбор
 * `{ error: { code, type } }` всё равно писать руками — именно `code` отличает
 * «кончились деньги» от «слишком часто просишь».
 *
 * Text→image идёт JSON'ом на `/images/generations`; редактирование и несколько
 * референсов — `multipart/form-data` на `/images/edits` с повторяющимся `image[]`.
 */
export class OpenAiProvider implements ImageProvider {
  readonly id = 'openai'
  readonly models: readonly ModelDescriptor[] = OPENAI_MODELS.map((model) => ({
    id: model.id,
    providerId: 'openai',
    label: model.label,
    supportsEdit: model.supportsEdit,
  }))

  readonly defaultModel: string
  readonly capabilities: ProviderCapabilities

  readonly #apiKey: string
  readonly #storage: FileStorage
  readonly #baseUrl: string
  readonly #fetch: FetchLike
  readonly #timeoutMs: number
  readonly #defaultSpec: OpenAiModelSpec

  constructor(options: OpenAiProviderOptions) {
    const modelId = options.model ?? DEFAULT_OPENAI_MODEL
    const spec = findOpenAiModel(modelId)
    if (!spec) {
      throw new ProviderError(
        'VALIDATION_FAILED',
        `OpenAI: неизвестная модель по умолчанию «${modelId}»`,
        false,
      )
    }

    this.#apiKey = options.apiKey
    this.#storage = options.storage
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#defaultSpec = spec
    this.defaultModel = spec.id
    this.capabilities = {
      edit: spec.supportsEdit,
      referenceImages: MAX_REFERENCE_IMAGES,
      // отдельного поля негатива у API нет — негатив вклеивает в промпт RequestBuilder
      negativePrompt: false,
      aspectRatio: Object.keys(spec.sizes),
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
    if (prompt.length === 0) throw invalid('OpenAI: пустой промпт — нечего генерировать')
    const size = this.#resolveSize(spec, req.aspectRatio)

    // картинки на входе есть — значит это /images/edits, даже когда исходника нет:
    // именно так один запрос принимает сразу несколько референсов
    const images = source ? [source, ...req.references] : [...req.references]
    const result =
      images.length === 0
        ? await this.#postJson(spec, prompt, size, signal)
        : await this.#postMultipart(spec, prompt, size, images, signal)

    if (!result.ok) {
      throw mapOpenAiHttpError(result.status, result.body, result.headers.get('retry-after'))
    }
    return this.#readImage(result.body, spec, size)
  }

  #postJson(
    spec: OpenAiModelSpec,
    prompt: string,
    size: string,
    signal: AbortSignal,
  ): ReturnType<typeof requestJson> {
    return requestJson(
      this.#fetch,
      `${this.#baseUrl}/images/generations`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({ model: spec.id, prompt, n: 1, size }),
      },
      { timeoutMs: this.#timeoutMs, signal, label: 'OpenAI' },
    )
  }

  async #postMultipart(
    spec: OpenAiModelSpec,
    prompt: string,
    size: string,
    images: readonly ImageRef[],
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof requestJson>>> {
    const form = new FormData()
    form.set('model', spec.id)
    form.set('prompt', prompt)
    form.set('n', '1')
    form.set('size', size)
    for (const [index, ref] of images.entries()) {
      const file = await this.#storage.get(ref.fileId)
      // поле повторяется — так API получает и исходник, и все референсы разом
      form.append(
        'image[]',
        new File([file.bytes], fileName(index, file.mimeType), {
          type: file.mimeType,
        }),
      )
    }

    return requestJson(
      this.#fetch,
      `${this.#baseUrl}/images/edits`,
      {
        method: 'POST',
        // content-type не ставим руками: boundary проставит сам fetch
        headers: { authorization: `Bearer ${this.#apiKey}` },
        body: form,
      },
      { timeoutMs: this.#timeoutMs, signal, label: 'OpenAI' },
    )
  }

  #readImage(body: unknown, spec: OpenAiModelSpec, size: string): ProviderImage {
    const data = readString(readArray(body, 'data')[0], 'b64_json')
    if (data === null) {
      throw new ProviderError(
        'VALIDATION_FAILED',
        'OpenAI вернул ответ без изображения в data[0].b64_json',
        false,
      )
    }

    const bytes = decodeBase64(data)
    return {
      bytes,
      // API тип файла не называет, поэтому определяем его по сигнатуре байтов
      mimeType: sniffImageMime(bytes) ?? 'image/png',
      model: spec.id,
      meta: { size, usage: readValue(body, 'usage'), created: readValue(body, 'created') },
    }
  }

  #resolveModel(requested: string | null): OpenAiModelSpec {
    if (requested === null) return this.#defaultSpec
    const spec = findOpenAiModel(requested)
    if (spec) return spec
    throw invalid(
      `OpenAI: модель «${requested}» не поддерживается. Доступны: ${OPENAI_MODELS.map((model) => model.id).join(', ')}`,
    )
  }

  #resolveSize(spec: OpenAiModelSpec, aspectRatio: string): string {
    const size = spec.sizes[aspectRatio]
    if (size !== undefined) return size
    throw invalid(
      `OpenAI: модель «${spec.id}» не поддерживает пропорции ${aspectRatio}. Доступны: ${Object.keys(spec.sizes).join(', ')}`,
    )
  }
}

function fileName(index: number, mimeType: string): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]
  return `image-${index}.${extension ?? 'png'}`
}

function invalid(message: string): ProviderError {
  return new ProviderError('VALIDATION_FAILED', message, false)
}
