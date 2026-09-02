import type { CreatePresetRequest, Preset, UpdatePresetRequest } from '@workflow/contracts'
import type { Clock, PresetRepository } from '@workflow/core'
import { systemClock } from '@workflow/core'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../client.js'
import { newId } from '../ids.js'
import { toPreset } from '../mappers.js'
import { presets } from '../schema.js'

export class DrizzlePresetRepository implements PresetRepository {
  readonly #db: Db
  readonly #clock: Clock

  constructor(db: Db, clock: Clock = systemClock) {
    this.#db = db
    this.#clock = clock
  }

  async list(): Promise<Preset[]> {
    const rows = await this.#db
      .select()
      .from(presets)
      .orderBy(asc(presets.createdAt), asc(presets.id))
    return rows.map(toPreset)
  }

  async findById(id: string): Promise<Preset | null> {
    const rows = await this.#db.select().from(presets).where(eq(presets.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toPreset(row)
  }

  async create(input: CreatePresetRequest): Promise<Preset> {
    // одна отметка времени на обе колонки: у только что созданного пресета
    // createdAt и updatedAt обязаны совпадать, иначе UI покажет «изменён» сразу после создания
    const now = this.#clock.now()
    const rows = await this.#db
      .insert(presets)
      .values({
        id: newId('preset'),
        name: input.name,
        mainPrompt: input.mainPrompt,
        negativePrompt: input.negativePrompt,
        referenceFileIds: input.references,
        defaults: input.defaults,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('INSERT не вернул строку пресета')
    return toPreset(row)
  }

  async update(id: string, patch: UpdatePresetRequest): Promise<Preset | null> {
    // Поля переносятся поимённо и только при `!== undefined`.
    // Спред патча затёр бы `negativePrompt` и `defaults` значением undefined,
    // а `??` не отличил бы «не передано» от осознанного обнуления.
    const values: Partial<typeof presets.$inferInsert> = { updatedAt: this.#clock.now() }
    if (patch.name !== undefined) values.name = patch.name
    if (patch.mainPrompt !== undefined) values.mainPrompt = patch.mainPrompt
    if (patch.negativePrompt !== undefined) values.negativePrompt = patch.negativePrompt
    if (patch.references !== undefined) values.referenceFileIds = [...patch.references]
    if (patch.defaults !== undefined) values.defaults = patch.defaults

    const rows = await this.#db.update(presets).set(values).where(eq(presets.id, id)).returning()
    const row = rows[0]
    return row === undefined ? null : toPreset(row)
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.#db
      .delete(presets)
      .where(eq(presets.id, id))
      .returning({ id: presets.id })
    return rows.length > 0
  }
}
