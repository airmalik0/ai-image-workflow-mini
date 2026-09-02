import { presetSchema } from '@workflow/contracts'
import type { Preset } from '@workflow/contracts'
import { z } from 'zod'
import { apiRequest } from '@/shared/api'

export const presetsQueryKey = ['presets'] as const

export const fetchPresets = (signal?: AbortSignal): Promise<Preset[]> =>
  apiRequest('/presets', {
    schema: z.array(presetSchema),
    ...(signal === undefined ? {} : { signal }),
  })
