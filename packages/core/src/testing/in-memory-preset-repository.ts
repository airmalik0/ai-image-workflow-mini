import type { CreatePresetRequest, Preset, UpdatePresetRequest } from '@workflow/contracts'
import type { Clock } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import type { PresetRepository } from '../ports/repositories.js'

/** Ин-мемори пресеты для тестов ядра и для интеграционных тестов без БД. */
export class InMemoryPresetRepository implements PresetRepository {
  readonly #presets = new Map<string, Preset>()
  readonly #clock: Clock
  #sequence = 0

  constructor(seed: readonly Preset[] = [], clock: Clock = systemClock) {
    this.#clock = clock
    for (const preset of seed) this.#presets.set(preset.id, preset)
  }

  list(): Promise<Preset[]> {
    return Promise.resolve([...this.#presets.values()])
  }

  findById(id: string): Promise<Preset | null> {
    return Promise.resolve(this.#presets.get(id) ?? null)
  }

  create(input: CreatePresetRequest): Promise<Preset> {
    this.#sequence += 1
    const now = this.#clock.now().toISOString()
    const preset: Preset = {
      id: `preset-${this.#sequence}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    }
    this.#presets.set(preset.id, preset)
    return Promise.resolve(preset)
  }

  update(id: string, patch: UpdatePresetRequest): Promise<Preset | null> {
    const preset = this.#presets.get(id)
    if (!preset) return Promise.resolve(null)
    // поля патча перечислены поимённо: спред затёр бы значения теми `undefined`,
    // которые zod оставляет в необязательных полях
    const next: Preset = {
      ...preset,
      name: patch.name ?? preset.name,
      mainPrompt: patch.mainPrompt ?? preset.mainPrompt,
      negativePrompt:
        patch.negativePrompt === undefined ? preset.negativePrompt : patch.negativePrompt,
      references: patch.references ?? preset.references,
      defaults: patch.defaults === undefined ? preset.defaults : patch.defaults,
      updatedAt: this.#clock.now().toISOString(),
    }
    this.#presets.set(id, next)
    return Promise.resolve(next)
  }

  remove(id: string): Promise<boolean> {
    return Promise.resolve(this.#presets.delete(id))
  }
}
