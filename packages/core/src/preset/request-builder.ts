import type { Preset } from '@workflow/contracts'
import type {
  EditRequest,
  GenerateRequest,
  ImageRef,
  ProviderCapabilities,
  RequestOrigin,
} from '../ports/image-provider.js'

/**
 * Параметры ноды, которые участвуют в сборке запроса. Специально шире, чем данные
 * одного вида нод: `generateImage` даёт модель и пропорции, `editImage` — только модель.
 */
export interface GenerateParams {
  model?: string | null
  aspectRatio?: string | null
}

export interface BuildInput {
  /** Промпт, пришедший по входному порту ноды (или из её собственного поля). */
  userPrompt: string
  preset: Preset | null
  params: GenerateParams
  capabilities: ProviderCapabilities
  origin?: RequestOrigin
}

/** Пропорции по умолчанию, если их не задали ни нода, ни пресет. */
const DEFAULT_ASPECT_RATIO = '1:1'

/**
 * Модель, которой будет исполнена нода: явное значение ноды → defaults пресета →
 * `null` («провайдер подставит свою»). Отдельная функция, потому что по этому же
 * значению выбирается провайдер: разойдись выбор со сборкой запроса — нода ушла бы
 * одному движку с моделью другого.
 */
export function resolveModel(params: GenerateParams, preset: Preset | null): string | null {
  return params.model ?? preset?.defaults?.model ?? null
}

/**
 * Утвердительная формулировка негатива для провайдеров без отдельного поля.
 * Список слов через запятую («clutter, noise») модели воспринимают как описание
 * желаемого и охотно дорисовывают именно то, что просили убрать, — проверено
 * на живых запросах, отчёт в docs/research/gemini-api.md.
 */
const NEGATIVE_PREFIX = 'The scene must not contain: '

/**
 * Слияние пресета, пользовательского промпта и параметров ноды в запрос к провайдеру.
 *
 * Чистая функция — в этом и смысл: правило «как пресет превращается в запрос» живёт
 * в одном месте и покрыто тестами без сети, а ни один React-компонент и ни один
 * адаптер провайдера его не знает.
 *
 * Приоритет параметров: явное значение ноды → defaults пресета → умолчание.
 * Возможности провайдера — последний фильтр: то, чего движок не умеет, либо
 * переносится в промпт (негатив), либо отбрасывается (лишние референсы).
 */
export function buildProviderRequest(input: BuildInput): GenerateRequest {
  const { preset, params, capabilities } = input

  const negative = preset?.negativePrompt?.trim() ?? ''
  const supportsNegative = capabilities.negativePrompt && negative.length > 0

  const request: GenerateRequest = {
    prompt: buildPrompt(input, supportsNegative ? '' : negative),
    negativePrompt: supportsNegative ? negative : null,
    references: buildReferences(preset, capabilities),
    model: resolveModel(params, preset),
    aspectRatio: pickAspectRatio(params, preset, capabilities),
  }

  return input.origin === undefined ? request : { ...request, origin: input.origin }
}

/**
 * То же слияние для операции редактирования: добавляется картинка со входа ноды.
 * Отдельная функция, а не флаг, чтобы `image` был обязателен на уровне типов.
 */
export function buildEditRequest(input: BuildInput & { image: ImageRef }): EditRequest {
  return { ...buildProviderRequest(input), image: input.image }
}

/**
 * Промпт пресета впереди пользовательского: он задаёт стиль сцены, а пользователь
 * уточняет предмет. Пустые части выбрасываются — иначе в запрос уходят висячие запятые.
 */
function buildPrompt(input: BuildInput, inlineNegative: string): string {
  const parts = [input.preset?.mainPrompt.trim() ?? '', input.userPrompt.trim()].filter(
    (part) => part.length > 0,
  )
  const base = parts.join(', ')
  if (inlineNegative.length === 0) return base
  const suffix = `${NEGATIVE_PREFIX}${inlineNegative}`
  return base.length === 0 ? suffix : `${base}. ${suffix}`
}

function buildReferences(preset: Preset | null, capabilities: ProviderCapabilities): ImageRef[] {
  if (!preset || capabilities.referenceImages <= 0) return []
  return preset.references
    .slice(0, capabilities.referenceImages)
    .map((fileId) => ({ fileId }) satisfies ImageRef)
}

/**
 * Неподдерживаемые пропорции не отправляются провайдеру: у Gemini часть значений
 * принимает только одна модель, остальные отвечают 400. Лучше отдать ближайшее
 * поддерживаемое, чем уронить job из-за настройки, которую пользователь
 * скопировал из другого пресета.
 */
function pickAspectRatio(
  params: GenerateParams,
  preset: Preset | null,
  capabilities: ProviderCapabilities,
): string {
  const requested = params.aspectRatio ?? preset?.defaults?.aspectRatio ?? DEFAULT_ASPECT_RATIO
  const supported = capabilities.aspectRatio
  if (supported.length === 0 || supported.includes(requested)) return requested
  return supported[0] ?? DEFAULT_ASPECT_RATIO
}
