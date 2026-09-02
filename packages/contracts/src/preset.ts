import { z } from 'zod'
import { MAX_PROMPT_LENGTH } from './graph/index.js'

export const presetDefaultsSchema = z.object({
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
})

export type PresetDefaults = z.infer<typeof presetDefaultsSchema>

export const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  mainPrompt: z.string().max(MAX_PROMPT_LENGTH),
  negativePrompt: z.string().max(MAX_PROMPT_LENGTH).nullable(),
  /** id файлов в FileStorage, а не сами байты */
  references: z.array(z.string().min(1)),
  defaults: presetDefaultsSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Preset = z.infer<typeof presetSchema>
