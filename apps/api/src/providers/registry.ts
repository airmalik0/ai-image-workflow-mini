import type { ModelDescriptor } from '@workflow/contracts'
import { DomainError, FakeProvider } from '@workflow/core'
import type { FakeFailure, FileStorage, ImageProvider, ProviderSelector } from '@workflow/core'
import { DemoLimitedProvider } from './demo-limited-provider.js'
import type { DemoQuota } from './demo-quota.js'
import { GeminiProvider } from './gemini/gemini-provider.js'
import { isGeminiImageSize } from './gemini/models.js'
import type { FetchLike } from './http.js'
import { OpenAiProvider } from './openai/openai-provider.js'

/**
 * Переменные окружения, от которых зависит выбор провайдера. Тип объявлен здесь,
 * а не берётся из общего конфига: реестр обязан оставаться проверяемым отдельно
 * от Fastify — тесты передают ему обычный объект, а не `process.env`.
 */
export interface ProviderEnvironment {
  IMAGE_PROVIDER?: string | undefined
  GEMINI_API_KEY?: string | undefined
  OPENAI_API_KEY?: string | undefined
  GEMINI_MODEL?: string | undefined
  GEMINI_IMAGE_SIZE?: string | undefined
  OPENAI_MODEL?: string | undefined
  /**
   * Ноды, на которых обязана падать заглушка, — список id через запятую.
   * Единственный способ воспроизвести сценарий ТЗ «нода упала → Retry»
   * снаружи, не ломая боевой ключ руками. На боевые провайдеры не влияет:
   * настройка принадлежит `fake` и читается только при его создании.
   *
   * `editImage-1` — падать всегда, `editImage-1:1` — падать только на первой
   * попытке в каждом запуске, чтобы повтор доводил ноду до успеха.
   */
  FAKE_FAIL_NODES?: string | undefined
}

export interface ProviderRegistryDeps {
  storage: FileStorage
  /** Подменяемый `fetch` — для интеграционных тестов без сети. */
  fetch?: FetchLike
  /**
   * Дневная квота демо-стенда. При `limit > 0` боевые провайдеры оборачиваются
   * предохранителем: по исчерпании квоты они уступают место заглушке, и это
   * объявляется в `GET /api/health`.
   */
  demoQuota?: DemoQuota
}

export interface ProviderRegistry extends ProviderSelector {
  /** Провайдер, которым исполняются ноды без явно выбранной модели. */
  readonly active: ImageProvider
  readonly byId: ReadonlyMap<string, ImageProvider>
  /** Плоский список моделей всех поднятых провайдеров — для `GET /api/models`. */
  readonly models: readonly ModelDescriptor[]
  /** Квота демо-стенда, если предохранитель включён; иначе `null`. */
  readonly demo: DemoQuota | null
  get(id: string): ImageProvider | undefined
}

/**
 * Порядок автовыбора: OpenAI, затем Gemini, затем заглушка.
 *
 * OpenAI первым не по старшинству, а потому что он прогнан вживую на всех трёх
 * сценариях задания. Ключ Gemini может лежать в окружении с нулевым балансом —
 * тогда «первый, у кого есть ключ» означало бы, что каждая генерация падает
 * на провайдере, который формально настроен. Дефолт обязан быть рабочим сам
 * по себе, без строки `IMAGE_PROVIDER=openai` в `.env`.
 */
const AUTO_ORDER = ['openai', 'gemini', 'fake'] as const

/**
 * Реестр доступных провайдеров и выбор активного по `IMAGE_PROVIDER`.
 *
 * Два правила, ради которых он существует:
 *
 * 1. **Без ключей приложение поднимается.** Заглушка есть всегда, `auto` без
 *    ключей выбирает её — проверяющий запускает проект без единого секрета.
 * 2. **Тихого отката на заглушку нет.** Если провайдер назван явно, а ключа
 *    к нему нет, старт падает с внятным сообщением. Молчаливая подмена сделала бы
 *    сценарий «нода упала → Retry» невоспроизводимым: вместо ошибки провайдера
 *    пользователь получал бы нарисованную локально картинку.
 *
 * Предохранитель демо-стенда (`demoQuota`) второму правилу не противоречит:
 * он переключает провайдер по исчерпанию квоты, а не по сбою, и объявляет это
 * в health и в интерфейсе. Ошибка боевого провайдера остаётся ошибкой.
 */
export function createProviderRegistry(
  env: ProviderEnvironment,
  deps: ProviderRegistryDeps,
): ProviderRegistry {
  const byId = new Map<string, ImageProvider>()
  const failNodes = failures(env.FAKE_FAIL_NODES)
  byId.set('fake', new FakeProvider(failNodes.length === 0 ? {} : { failNodes }))

  const geminiKey = value(env.GEMINI_API_KEY)
  if (geminiKey !== null) byId.set('gemini', createGemini(env, deps, geminiKey))

  const openaiKey = value(env.OPENAI_API_KEY)
  if (openaiKey !== null) byId.set('openai', createOpenAi(env, deps, openaiKey))

  const demo = deps.demoQuota !== undefined && deps.demoQuota.limit > 0 ? deps.demoQuota : null
  if (demo !== null) guardLiveProviders(byId, demo)

  const active = selectActive(value(env.IMAGE_PROVIDER) ?? 'auto', byId)
  const owners = modelOwners(byId)

  return {
    active,
    byId,
    models: [...byId.values()].flatMap((provider) => provider.models),
    demo,
    get: (id) => byId.get(id),
    // модель, которой нет ни у кого, уходит активному провайдеру: его отказ
    // «такой модели нет» — честный ответ, а подстановка чужого движка была бы
    // той самой тихой подменой, которая здесь запрещена
    forModel: (model) => (model === null ? active : (owners.get(model) ?? active)),
  }
}

/**
 * Модель → провайдер, который её исполняет. Строится по самим провайдерам, а не
 * по отдельной таблице: список моделей в интерфейсе и маршрутизация обязаны
 * приходить из одного источника, иначе чип модели обещает то, чего нельзя сделать.
 *
 * Первый заявивший модель её и получает — совпадений между вендорами нет,
 * а если появятся, приоритет отдаётся порядку регистрации, а не случаю.
 */
function modelOwners(byId: ReadonlyMap<string, ImageProvider>): ReadonlyMap<string, ImageProvider> {
  const owners = new Map<string, ImageProvider>()
  for (const provider of byId.values()) {
    for (const model of provider.models) {
      if (!owners.has(model.id)) owners.set(model.id, provider)
    }
  }
  return owners
}

/**
 * Обёртка ставится на все боевые провайдеры, а не только на активный: иначе
 * предохранитель обходился бы выбором модели другого провайдера в ноде.
 * Заглушка не оборачивается — она бесплатная, считать у неё нечего.
 */
function guardLiveProviders(byId: Map<string, ImageProvider>, quota: DemoQuota): void {
  const offline = byId.get('fake')
  if (offline === undefined) return

  for (const [id, live] of [...byId]) {
    if (id === 'fake') continue
    byId.set(id, new DemoLimitedProvider({ live, offline, quota }))
  }
}

function selectActive(requested: string, byId: ReadonlyMap<string, ImageProvider>): ImageProvider {
  if (requested === 'auto') {
    const found = AUTO_ORDER.map((id) => byId.get(id)).find((provider) => provider !== undefined)
    if (found) return found
    throw config('не удалось выбрать провайдер изображений')
  }

  const provider = byId.get(requested)
  if (provider) return provider

  if (requested === 'gemini' || requested === 'openai') {
    const key = requested === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'
    throw config(
      `IMAGE_PROVIDER=${requested}, но ключ ${key} не задан. ` +
        'Укажите ключ или переключитесь на IMAGE_PROVIDER=fake',
    )
  }

  throw config(
    `IMAGE_PROVIDER=«${requested}» — неизвестное значение. Допустимые: auto, gemini, openai, fake`,
  )
}

function createGemini(
  env: ProviderEnvironment,
  deps: ProviderRegistryDeps,
  apiKey: string,
): ImageProvider {
  const model = value(env.GEMINI_MODEL)
  const imageSize = value(env.GEMINI_IMAGE_SIZE)
  if (imageSize !== null && !isGeminiImageSize(imageSize)) {
    throw config(`GEMINI_IMAGE_SIZE=«${imageSize}» — допустимые значения: 512, 1K, 2K, 4K`)
  }

  return new GeminiProvider({
    apiKey,
    storage: deps.storage,
    ...(model === null ? {} : { model }),
    ...(imageSize === null ? {} : { imageSize }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  })
}

function createOpenAi(
  env: ProviderEnvironment,
  deps: ProviderRegistryDeps,
  apiKey: string,
): ImageProvider {
  const model = value(env.OPENAI_MODEL)
  return new OpenAiProvider({
    apiKey,
    storage: deps.storage,
    ...(model === null ? {} : { model }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  })
}

/** Список через запятую: пробелы и пустые элементы выбрасываются. */
function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/**
 * Разбор `FAKE_FAIL_NODES`: `nodeId` — падать всегда, `nodeId:N` — падать первые
 * N попыток в каждом запуске. Опечатка в числе роняет старт: молча отключённый
 * сбой выглядел бы как работающий стенд, на котором сценарий retry не показать.
 */
function failures(raw: string | undefined): (string | FakeFailure)[] {
  return list(raw).map((entry) => {
    const separator = entry.lastIndexOf(':')
    if (separator === -1) return entry

    const nodeId = entry.slice(0, separator).trim()
    const times = Number(entry.slice(separator + 1).trim())
    if (nodeId.length === 0 || !Number.isInteger(times) || times < 1) {
      throw config(
        `FAKE_FAIL_NODES=«${entry}» — после двоеточия ожидается число попыток от 1. ` +
          'Без двоеточия нода падает всегда',
      )
    }
    return { nodeId, times }
  })
}

/** Пустая строка в переменной окружения — это «не задано», а не ключ из нуля символов. */
function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed
}

function config(message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', message)
}
