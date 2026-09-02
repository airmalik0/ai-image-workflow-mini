/**
 * Что реально принимает каждая image-модель Gemini. Таблица собрана перебором
 * всех значений живыми запросами (`docs/research/gemini-api.md`, §5 и §7), а не
 * переписана из документации: дока обещает 14 аспектов и четыре размера всем,
 * на деле у каждой модели свой набор.
 *
 * Проверять на своей стороне обязательно: `gemini-2.5-flash-image` отвечает
 * HTTP 200 на любой `imageSize`, молча отдавая 1024×1024. «Раз 200 — значит
 * применилось» здесь неверно, и пользователь получил бы 1K вместо запрошенного 4K.
 */

export const GEMINI_IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
export type GeminiImageSize = (typeof GEMINI_IMAGE_SIZES)[number]

/** Полный список пропорций, который принимает proto-валидация API. */
export const GEMINI_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
] as const

/** Баннерные пропорции (1:4, 4:1, 1:8, 8:1) есть только у `gemini-3.1-flash-image`. */
const COMMON_ASPECT_RATIOS = GEMINI_ASPECT_RATIOS.slice(0, 10)

export interface GeminiModelSpec {
  id: string
  label: string
  aspectRatios: readonly string[]
  imageSizes: readonly GeminiImageSize[]
  supportsEdit: boolean
}

export const GEMINI_MODELS: readonly GeminiModelSpec[] = [
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    aspectRatios: GEMINI_ASPECT_RATIOS,
    imageSizes: ['512', '1K', '2K', '4K'],
    supportsEdit: true,
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    aspectRatios: COMMON_ASPECT_RATIOS,
    imageSizes: ['1K', '2K', '4K'],
    supportsEdit: true,
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image',
    aspectRatios: COMMON_ASPECT_RATIOS,
    imageSizes: ['1K'],
    supportsEdit: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image (legacy)',
    aspectRatios: COMMON_ASPECT_RATIOS,
    imageSizes: ['1K'],
    supportsEdit: true,
  },
]

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image'

export function findGeminiModel(id: string): GeminiModelSpec | null {
  return GEMINI_MODELS.find((model) => model.id === id) ?? null
}

export function isGeminiImageSize(value: string): value is GeminiImageSize {
  return (GEMINI_IMAGE_SIZES as readonly string[]).includes(value)
}
