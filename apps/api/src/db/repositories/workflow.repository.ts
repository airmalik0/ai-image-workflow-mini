import type { SaveWorkflowRequest, Workflow } from '@workflow/contracts'
import type { Clock, WorkflowRepository } from '@workflow/core'
import { systemClock } from '@workflow/core'
import { asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../client.js'
import { newId } from '../ids.js'
import { toWorkflow } from '../mappers.js'
import { workflows } from '../schema.js'

export class DrizzleWorkflowRepository implements WorkflowRepository {
  readonly #db: Db
  readonly #clock: Clock

  constructor(db: Db, clock: Clock = systemClock) {
    this.#db = db
    this.#clock = clock
  }

  async list(): Promise<Workflow[]> {
    // «последний изменённый — сверху»: список workflow в UI это и показывает
    const rows = await this.#db
      .select()
      .from(workflows)
      .orderBy(desc(workflows.updatedAt), asc(workflows.id))
    return rows.map(toWorkflow)
  }

  async findById(id: string): Promise<Workflow | null> {
    const rows = await this.#db.select().from(workflows).where(eq(workflows.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toWorkflow(row)
  }

  async create(input: SaveWorkflowRequest): Promise<Workflow> {
    const now = this.#clock.now()
    const rows = await this.#db
      .insert(workflows)
      .values({
        id: newId('workflow'),
        name: input.name,
        graph: input.graph,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('INSERT не вернул строку workflow')
    return toWorkflow(row)
  }

  async update(id: string, input: SaveWorkflowRequest): Promise<Workflow | null> {
    // Граф заменяется целиком: он единая структура, и частичный патч ноды
    // без ребра оставил бы в базе заведомо невалидный граф.
    const rows = await this.#db
      .update(workflows)
      .set({ name: input.name, graph: input.graph, updatedAt: this.#clock.now() })
      .where(eq(workflows.id, id))
      .returning()
    const row = rows[0]
    return row === undefined ? null : toWorkflow(row)
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.#db
      .delete(workflows)
      .where(eq(workflows.id, id))
      .returning({ id: workflows.id })
    return rows.length > 0
  }
}
