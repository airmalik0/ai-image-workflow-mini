import type { PresetDefaults } from '@workflow/contracts'
import type { FileStorage } from '@workflow/core'
import type { Db } from './client.js'
import { buildReferenceImages } from './reference-images.js'
import { files, presets } from './schema.js'

export interface SeedDependencies {
  db: Db
  storage: FileStorage
}

export interface SeedResult {
  /** Сколько пресетов добавлено именно этим вызовом. Повторный сид даёт нули. */
  presetsInserted: number
  filesInserted: number
}

interface SeedPreset {
  id: string
  name: string
  mainPrompt: string
  negativePrompt: string | null
  /** Слаги референсных картинок из `reference-images.ts`. */
  references: readonly string[]
  defaults: PresetDefaults | null
}

const DEFAULT_MODEL = 'gemini-3.1-flash-image'

/**
 * Пресеты сида. Первый — тот самый «Premium 3D» из ТЗ; остальные добавлены, чтобы
 * выбор пресета в UI был осмысленным, а не витриной из одного элемента.
 *
 * Идентификаторы — читаемые слаги, а не uuid: на них ссылаются ноды сохранённых
 * workflow, и пересев базы не должен ломать эти ссылки.
 *
 * Негативный промпт — список через запятую сознательно: `RequestBuilder`
 * подставляет его в утвердительную формулировку «The scene must not contain: …»,
 * потому что отдельного поля негатива нет ни у Gemini, ни у OpenAI.
 */
export const SEED_PRESETS: readonly SeedPreset[] = [
  {
    id: 'preset_premium_3d',
    name: 'Premium 3D',
    mainPrompt:
      'premium minimal 3D visual, soft studio lighting, matte pastel materials, ' +
      'gentle depth of field, subtle rim light, clean neutral backdrop, product-grade render',
    negativePrompt: 'clutter, noisy background, harsh shadows, text, watermark, logo',
    references: ['ref-premium-3d-a', 'ref-premium-3d-b'],
    defaults: { model: DEFAULT_MODEL, aspectRatio: '1:1' },
  },
  {
    id: 'preset_studio_packshot',
    name: 'Предметная съёмка',
    mainPrompt:
      'studio packshot on seamless white cyclorama, softbox key light with large diffuser, ' +
      'accurate colours, crisp edges, soft contact shadow, catalogue photography',
    negativePrompt: 'props, reflections of the crew, colour cast, blown highlights, text',
    references: ['ref-studio-packshot'],
    defaults: { model: DEFAULT_MODEL, aspectRatio: '4:3' },
  },
  {
    id: 'preset_watercolor_sketch',
    name: 'Акварельный скетч',
    mainPrompt:
      'loose watercolour illustration on cold-pressed paper, visible paper grain, ' +
      'wet-on-wet bleeding, pastel palette, generous white space, light ink contour',
    negativePrompt: 'photorealism, 3D render, heavy black outlines, digital gradients',
    references: ['ref-watercolor'],
    defaults: { model: DEFAULT_MODEL, aspectRatio: '3:4' },
  },
  {
    id: 'preset_neon_poster',
    name: 'Неоновый постер',
    mainPrompt:
      'retro-futuristic neon poster, deep indigo night, magenta and cyan glow, ' +
      'perspective grid horizon, volumetric haze, high contrast, VHS grain',
    negativePrompt: 'daylight, pastel palette, empty flat background, text, watermark',
    references: ['ref-neon-poster'],
    defaults: { model: DEFAULT_MODEL, aspectRatio: '16:9' },
  },
  {
    id: 'preset_soft_portrait',
    name: 'Мягкий портретный свет',
    mainPrompt:
      'portrait lit by a large soft key at 45 degrees, warm skin tones, ' +
      'shallow depth of field, natural texture retained, muted background falloff',
    negativePrompt: 'plastic skin, over-smoothing, double catchlights, distorted hands, text',
    references: ['ref-soft-portrait'],
    defaults: { model: DEFAULT_MODEL, aspectRatio: '3:4' },
  },
]

/**
 * Сид пресетов и референсных картинок. Идемпотентен: повторный запуск ничего
 * не дублирует и не перетирает — сид зовётся при каждом старте контейнера,
 * а не один раз руками.
 */
export async function seedDatabase(deps: SeedDependencies): Promise<SeedResult> {
  const fileIdBySlug = new Map<string, string>()
  let filesInserted = 0

  for (const image of buildReferenceImages()) {
    // хранилище адресуется содержимым, поэтому повторный put — не запись, а вычисление id
    const fileId = await deps.storage.put(image.bytes, image.mimeType)
    fileIdBySlug.set(image.slug, fileId)

    const inserted = await deps.db
      .insert(files)
      .values({
        id: fileId,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
        source: 'seed',
      })
      .onConflictDoNothing({ target: files.id })
      .returning({ id: files.id })
    filesInserted += inserted.length
  }

  const rows = SEED_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    mainPrompt: preset.mainPrompt,
    negativePrompt: preset.negativePrompt,
    referenceFileIds: preset.references.map((slug) => {
      const fileId = fileIdBySlug.get(slug)
      if (fileId === undefined) throw new Error(`Референс «${slug}» не найден среди картинок сида`)
      return fileId
    }),
    defaults: preset.defaults,
  }))

  const insertedPresets = await deps.db
    .insert(presets)
    .values(rows)
    .onConflictDoNothing({ target: presets.id })
    .returning({ id: presets.id })

  return { presetsInserted: insertedPresets.length, filesInserted }
}
