import type { Job, Run } from '@workflow/contracts'
import type { Clock } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import { DomainError } from '../errors.js'
import type { CreateRunInput, JobPatch, RunPatch, RunRepository } from '../ports/repositories.js'

/**
 * Ин-мемори реализация хранилища запусков для тестов ядра.
 * Живёт в `core`, а не в `api`, чтобы тесты движка не требовали Postgres:
 * доменные сценарии проверяются за миллисекунды и без Docker.
 */
export class InMemoryRunRepository implements RunRepository {
  readonly #runs = new Map<string, Run>()
  /** runId → nodeId → job; порядок вставки совпадает с порядком нод в графе. */
  readonly #jobs = new Map<string, Map<string, Job>>()
  readonly #clock: Clock
  #sequence = 0

  constructor(clock: Clock = systemClock) {
    this.#clock = clock
  }

  createRun(input: CreateRunInput): Promise<Run> {
    this.#sequence += 1
    const run: Run = {
      id: `run-${this.#sequence}`,
      workflowId: input.workflowId,
      status: 'queued',
      graph: input.graph,
      createdAt: this.#now(),
      startedAt: null,
      finishedAt: null,
    }
    this.#runs.set(run.id, run)
    this.#jobs.set(run.id, new Map())
    return Promise.resolve(run)
  }

  findRun(runId: string): Promise<Run | null> {
    return Promise.resolve(this.#runs.get(runId) ?? null)
  }

  listRuns(limit: number): Promise<Run[]> {
    return Promise.resolve([...this.#runs.values()].reverse().slice(0, limit))
  }

  updateRun(runId: string, patch: RunPatch): Promise<Run> {
    const run = this.#runs.get(runId)
    if (!run) throw new DomainError('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)
    const next: Run = { ...run, ...patch }
    this.#runs.set(runId, next)
    return Promise.resolve(next)
  }

  ensureJobs(runId: string, nodeIds: readonly string[]): Promise<Job[]> {
    const jobs = this.#jobsOf(runId)
    for (const nodeId of nodeIds) {
      if (jobs.has(nodeId)) continue
      jobs.set(nodeId, {
        id: `${runId}:${nodeId}`,
        runId,
        nodeId,
        status: 'idle',
        attempt: 0,
        startedAt: null,
        finishedAt: null,
        output: null,
        error: null,
      })
    }
    return Promise.resolve([...jobs.values()])
  }

  listJobs(runId: string): Promise<Job[]> {
    return Promise.resolve([...this.#jobsOf(runId).values()])
  }

  updateJob(runId: string, nodeId: string, patch: JobPatch): Promise<Job> {
    const jobs = this.#jobsOf(runId)
    const job = jobs.get(nodeId)
    if (!job) {
      throw new DomainError('RUN_NOT_FOUND', `В запуске «${runId}» нет job'а для ноды «${nodeId}»`)
    }
    const next: Job = { ...job, ...patch }
    jobs.set(nodeId, next)
    return Promise.resolve(next)
  }

  #jobsOf(runId: string): Map<string, Job> {
    const existing = this.#jobs.get(runId)
    if (existing) return existing
    const created = new Map<string, Job>()
    this.#jobs.set(runId, created)
    return created
  }

  #now(): string {
    return this.#clock.now().toISOString()
  }
}
