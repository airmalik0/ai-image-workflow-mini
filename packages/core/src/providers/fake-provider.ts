import type { ModelDescriptor } from '@workflow/contracts'
import { ProviderError } from '../errors.js'
import type {
  EditRequest,
  GenerateRequest,
  ImageProvider,
  ProviderCapabilities,
  ProviderImage,
} from '../ports/image-provider.js'
import { encodePng } from './png.js'

/**
 * Настроенный сбой ноды с ограничением по числу попыток. Попытки считаются
 * внутри одного запуска, а не за всю жизнь процесса: иначе сбой случался бы
 * ровно один раз с момента старта, и повторить сценарий «нода упала → Retry»
 * второй раз было бы нечем.
 */
export interface FakeFailure {
  nodeId: string
  /** Сколько первых попыток ноды в каждом запуске обязаны упасть. */
  times: number
}

export interface FakeProviderOptions {
  /** Сколько «генерировать» одну картинку. Задержка честная и прерывается по AbortSignal. */
  latencyMs?: number
  /**
   * Ноды, на которых провайдер обязан упасть, — для сценарных тестов и демонстрации
   * retry. Идентификатор строкой означает «падать всегда»; `FakeFailure` ограничивает
   * сбой первыми попытками в запуске, и тогда повтор доводит ноду до успеха.
   */
  failNodes?: readonly (string | FakeFailure)[]
  /** Длинная сторона картинки в пикселях. */
  size?: number
}

/** `null` — падать всегда; число — падать столько первых попыток в каждом запуске. */
type FailLimit = number | null

const toFailures = (entries: readonly (string | FakeFailure)[]): Map<string, FailLimit> =>
  new Map(
    entries.map((entry) =>
      typeof entry === 'string' ? [entry, null] : [entry.nodeId, entry.times],
    ),
  )

const DEFAULT_SIZE = 320
const MODEL_ID = 'fake-image-1'

const MODELS: readonly ModelDescriptor[] = [
  { id: MODEL_ID, providerId: 'fake', label: 'Fake Image', supportsEdit: true },
]

/**
 * Детерминированный провайдер, рисующий картинку локально.
 *
 * Он существует не ради тестов, а ради проверяющего: без `GEMINI_API_KEY`
 * приложение обязано подниматься и полностью работать. Поэтому провайдер
 * выбирается явно (`IMAGE_PROVIDER=fake` или отсутствие ключа) и никогда не
 * подменяет собой упавший боевой провайдер: тихая подмена ошибки заглушкой
 * сделала бы сценарий «нода упала → Retry» невоспроизводимым.
 *
 * Картинка выводится из промпта: цвет фона и полос — хеш текста, сам промпт
 * пишется в метаданные PNG. Один и тот же запрос всегда даёт байт в байт то же
 * изображение, поэтому по картинке видно, что именно ушло в провайдер.
 */
export class FakeProvider implements ImageProvider {
  readonly id = 'fake'
  readonly models = MODELS
  readonly defaultModel = MODEL_ID
  readonly capabilities: ProviderCapabilities = {
    edit: true,
    referenceImages: 4,
    negativePrompt: true,
    aspectRatio: ['1:1', '3:4', '4:3', '9:16', '16:9'],
  }

  readonly #latencyMs: number
  readonly #size: number
  #failNodes: Map<string, FailLimit>
  /** Попытки ноды в разрезе запуска: ключ — `runId|nodeId`. */
  #attempts = new Map<string, number>()

  #calls = 0
  #aborted = 0
  #active = 0
  #peak = 0
  readonly #callsByNode = new Map<string, number>()

  constructor(options: FakeProviderOptions = {}) {
    this.#latencyMs = options.latencyMs ?? 0
    this.#size = options.size ?? DEFAULT_SIZE
    this.#failNodes = toFailures(options.failNodes ?? [])
  }

  /** Всего обращений к провайдеру. */
  get calls(): number {
    return this.#calls
  }

  /** Сколько запросов шло одновременно в пике — доказательство работы семафора. */
  get peakConcurrency(): number {
    return this.#peak
  }

  /** Сколько запросов было прервано сигналом отмены. */
  get aborted(): number {
    return this.#aborted
  }

  callsFor(nodeId: string): number {
    return this.#callsByNode.get(nodeId) ?? 0
  }

  setFailingNodes(nodeIds: readonly (string | FakeFailure)[]): void {
    this.#failNodes = toFailures(nodeIds)
    // Список задан заново — значит, заново считаются и попытки: иначе нода,
    // настроенная падать первые N раз, унесла бы с собой счётчик прошлой настройки.
    this.#attempts.clear()
  }

  generate(req: GenerateRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#run(req, signal, 'generate')
  }

  edit(req: EditRequest, signal: AbortSignal): Promise<ProviderImage> {
    return this.#run(req, signal, `edit:${req.image.fileId}`)
  }

  async #run(req: GenerateRequest, signal: AbortSignal, mode: string): Promise<ProviderImage> {
    const nodeId = req.origin?.nodeId ?? ''
    this.#calls += 1
    this.#callsByNode.set(nodeId, (this.#callsByNode.get(nodeId) ?? 0) + 1)
    this.#active += 1
    this.#peak = Math.max(this.#peak, this.#active)

    try {
      await this.#delay(signal)
      const failure = this.#failureFor(req.origin?.runId ?? '', nodeId)
      if (failure !== null) throw failure
      return this.#draw(req, mode)
    } finally {
      this.#active -= 1
    }
  }

  /**
   * Настроен ли сбой на этой попытке. Счётчик трогается только у названных нод:
   * иначе карта росла бы по всем нодам всех запусков стенда.
   */
  #failureFor(runId: string, nodeId: string): ProviderError | null {
    const limit = this.#failNodes.get(nodeId)
    if (limit === undefined) return null

    const key = `${runId}|${nodeId}`
    const seen = this.#attempts.get(key) ?? 0
    this.#attempts.set(key, seen + 1)
    if (limit !== null && seen >= limit) return null

    const scope =
      limit === null
        ? ''
        : `: ${limit === 1 ? 'в запуске падает первая попытка' : `в запуске падают первые ${limit} ${plural(limit)}`}, эта — ${seen + 1}-я`
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      `fake-провайдер настроен ронять ноду «${nodeId}»${scope}`,
      false,
    )
  }

  #delay(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.#aborted += 1
      return Promise.reject(abortError())
    }
    if (this.#latencyMs <= 0) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        this.#aborted += 1
        reject(abortError())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, this.#latencyMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  #draw(req: GenerateRequest, mode: string): ProviderImage {
    const seed = hash(`${mode}|${req.prompt}|${req.negativePrompt ?? ''}`)
    const [width, height] = dimensions(req.aspectRatio, this.#size)
    const background = colorFrom(seed)
    const stripe = colorFrom(seed * 2654435761)

    const rgb = new Uint8Array(width * height * 3)
    const band = Math.max(1, Math.floor(height / 8))
    for (let y = 0; y < height; y += 1) {
      const color = Math.floor(y / band) % 2 === 0 ? background : stripe
      for (let x = 0; x < width; x += 1) rgb.set(color, (y * width + x) * 3)
    }

    return {
      bytes: encodePng({
        width,
        height,
        rgb,
        text: [
          { keyword: 'prompt', value: req.prompt },
          { keyword: 'provider', value: `fake/${mode}` },
        ],
      }),
      mimeType: 'image/png',
      model: req.model ?? this.defaultModel,
      meta: { width, height, aspectRatio: req.aspectRatio, references: req.references.length },
    }
  }
}

function abortError(): ProviderError {
  return new ProviderError('PROVIDER_TIMEOUT', 'Генерация прервана сигналом отмены', false)
}

/** Русское склонение слова «попытка» после числа больше единицы. */
function plural(count: number): string {
  const tail = count % 100
  if (tail >= 11 && tail <= 14) return 'попыток'
  switch (count % 10) {
    case 2:
    case 3:
    case 4:
      return 'попытки'
    default:
      return 'попыток'
  }
}

/** FNV-1a: нужен детерминированный разброс, а не криптография. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

function colorFrom(seed: number): [number, number, number] {
  const value = seed >>> 0
  return [64 + (value % 160), 64 + ((value >>> 8) % 160), 64 + ((value >>> 16) % 160)]
}

function dimensions(aspectRatio: string, size: number): [number, number] {
  const [rawWidth, rawHeight] = aspectRatio.split(':')
  const width = Number(rawWidth)
  const height = Number(rawHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [size, size]
  }
  return width >= height
    ? [size, Math.max(1, Math.round((size * height) / width))]
    : [Math.max(1, Math.round((size * width) / height)), size]
}
