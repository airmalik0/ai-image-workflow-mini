import type { SaveWorkflowRequest, Workflow } from '@workflow/contracts'
import type { Clock, WorkflowRepository } from '@workflow/core'
import { systemClock } from '@workflow/core'

/**
 * Ин-мемори workflow для тестов роутов. В `@workflow/core/testing` его нет:
 * ядру такой репозиторий не нужен — граф оно получает уже разрешённым.
 */
export class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly #workflows = new Map<string, Workflow>()
  readonly #clock: Clock
  #sequence = 0

  constructor(clock: Clock = systemClock) {
    this.#clock = clock
  }

  list(): Promise<Workflow[]> {
    // «последний изменённый — сверху», как у Drizzle-реализации
    return Promise.resolve(
      [...this.#workflows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    )
  }

  findById(id: string): Promise<Workflow | null> {
    return Promise.resolve(this.#workflows.get(id) ?? null)
  }

  create(input: SaveWorkflowRequest): Promise<Workflow> {
    this.#sequence += 1
    const now = this.#clock.now().toISOString()
    const workflow: Workflow = {
      id: `workflow-${this.#sequence}`,
      name: input.name,
      graph: input.graph,
      createdAt: now,
      updatedAt: now,
    }
    this.#workflows.set(workflow.id, workflow)
    return Promise.resolve(workflow)
  }

  update(id: string, input: SaveWorkflowRequest): Promise<Workflow | null> {
    const existing = this.#workflows.get(id)
    if (!existing) return Promise.resolve(null)
    const updated: Workflow = {
      ...existing,
      name: input.name,
      graph: input.graph,
      updatedAt: this.#clock.now().toISOString(),
    }
    this.#workflows.set(id, updated)
    return Promise.resolve(updated)
  }

  remove(id: string): Promise<boolean> {
    return Promise.resolve(this.#workflows.delete(id))
  }
}
