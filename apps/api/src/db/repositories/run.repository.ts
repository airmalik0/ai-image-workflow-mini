import type { Job, Run } from '@workflow/contracts'
import type { Clock, CreateRunInput, JobPatch, RunPatch, RunRepository } from '@workflow/core'
import { DomainError, systemClock } from '@workflow/core'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../client.js'
import { newId } from '../ids.js'
import { dateFromIso, toJob, toRun } from '../mappers.js'
import { jobs, runs } from '../schema.js'

export class DrizzleRunRepository implements RunRepository {
  readonly #db: Db
  readonly #clock: Clock

  constructor(db: Db, clock: Clock = systemClock) {
    this.#db = db
    this.#clock = clock
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const rows = await this.#db
      .insert(runs)
      .values({
        id: newId('run'),
        workflowId: input.workflowId,
        status: 'queued',
        graph: input.graph,
        createdAt: this.#clock.now(),
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('INSERT не вернул строку запуска')
    return toRun(row)
  }

  async findRun(runId: string): Promise<Run | null> {
    const rows = await this.#db.select().from(runs).where(eq(runs.id, runId)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toRun(row)
  }

  async listRuns(limit: number): Promise<Run[]> {
    const rows = await this.#db.select().from(runs).orderBy(desc(runs.seq)).limit(limit)
    return rows.map(toRun)
  }

  async updateRun(runId: string, patch: RunPatch): Promise<Run> {
    const values: Partial<typeof runs.$inferInsert> = {}
    if (patch.status !== undefined) values.status = patch.status
    if (patch.startedAt !== undefined) values.startedAt = dateFromIso(patch.startedAt)
    if (patch.finishedAt !== undefined) values.finishedAt = dateFromIso(patch.finishedAt)

    // пустой патч — не повод отправлять в базу `UPDATE ... SET` без единой колонки:
    // Postgres такой запрос не принимает, а движок иногда «подтверждает» текущее состояние
    if (Object.keys(values).length === 0) {
      const run = await this.findRun(runId)
      if (run === null) throw runNotFound(runId)
      return run
    }

    const rows = await this.#db.update(runs).set(values).where(eq(runs.id, runId)).returning()
    const row = rows[0]
    if (row === undefined) throw runNotFound(runId)
    return toRun(row)
  }

  /**
   * Идемпотентная постановка job'ов на все ноды графа.
   *
   * `ON CONFLICT (run_id, node_id) DO NOTHING` — единственная причина, по которой
   * в схеме есть уникальный индекс `jobs_run_node_uq`. Повторный вызов (перезапуск API,
   * дубль сообщения в очереди, гонка двух воркеров) обязан оставить прогресс нетронутым,
   * а не сбросить уже выполненные ноды в `idle`.
   */
  async ensureJobs(runId: string, nodeIds: readonly string[]): Promise<Job[]> {
    if (nodeIds.length > 0) {
      await this.#db
        .insert(jobs)
        .values(
          nodeIds.map((nodeId) => ({
            id: newId('job'),
            runId,
            nodeId,
            status: 'idle' as const,
            attempt: 0,
          })),
        )
        .onConflictDoNothing({ target: [jobs.runId, jobs.nodeId] })
    }
    return this.listJobs(runId)
  }

  async listJobs(runId: string): Promise<Job[]> {
    const rows = await this.#db
      .select()
      .from(jobs)
      .where(eq(jobs.runId, runId))
      .orderBy(asc(jobs.seq))
    return rows.map(toJob)
  }

  async updateJob(runId: string, nodeId: string, patch: JobPatch): Promise<Job> {
    // Ключевое место всей персистентности: `undefined` значит «поле не передано»,
    // `null` — «обнулить». Retry присылает `output: null`, `error: null`,
    // `startedAt: null`, `finishedAt: null`, и любая попытка схлопнуть эти два
    // случая (спред патча, `??`, `Object.assign`) оставила бы на перезапущенной
    // ноде результат прошлой попытки.
    const values: Partial<typeof jobs.$inferInsert> = {}
    if (patch.status !== undefined) values.status = patch.status
    if (patch.attempt !== undefined) values.attempt = patch.attempt
    if (patch.startedAt !== undefined) values.startedAt = dateFromIso(patch.startedAt)
    if (patch.finishedAt !== undefined) values.finishedAt = dateFromIso(patch.finishedAt)
    if (patch.output !== undefined) values.output = patch.output
    if (patch.error !== undefined) values.error = patch.error

    const where = and(eq(jobs.runId, runId), eq(jobs.nodeId, nodeId))

    if (Object.keys(values).length === 0) {
      const rows = await this.#db.select().from(jobs).where(where).limit(1)
      const row = rows[0]
      if (row === undefined) throw jobNotFound(runId, nodeId)
      return toJob(row)
    }

    const rows = await this.#db.update(jobs).set(values).where(where).returning()
    const row = rows[0]
    if (row === undefined) throw jobNotFound(runId, nodeId)
    return toJob(row)
  }
}

function runNotFound(runId: string): DomainError {
  return new DomainError('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)
}

function jobNotFound(runId: string, nodeId: string): DomainError {
  return new DomainError('RUN_NOT_FOUND', `В запуске «${runId}» нет job'а для ноды «${nodeId}»`)
}
