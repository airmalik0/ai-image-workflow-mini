import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BRANCHING_GRAPH } from '../testing/run-repository.contract.js'
import type { TestDatabase } from '../testing/test-database.js'
import { createTestDatabase, probeTestDatabase } from '../testing/test-database.js'
import { DrizzleWorkflowRepository } from './workflow.repository.js'

const unavailable = await probeTestDatabase()

describe.skipIf(unavailable !== null)('DrizzleWorkflowRepository', () => {
  let database: TestDatabase | null = null

  beforeAll(async () => {
    database = await createTestDatabase('workflows')
  })

  afterAll(async () => {
    await database?.close()
  })

  async function repository(): Promise<DrizzleWorkflowRepository> {
    if (database === null) throw new Error('тестовая база не поднята')
    await database.truncate()
    return new DrizzleWorkflowRepository(database.db)
  }

  it('сохраняет граф целиком и читает его обратно без потерь', async () => {
    const repo = await repository()
    const workflow = await repo.create({ name: 'Ветвление', graph: BRANCHING_GRAPH })

    expect(workflow.name).toBe('Ветвление')
    expect(workflow.graph).toEqual(BRANCHING_GRAPH)
    expect(await repo.findById(workflow.id)).toEqual(workflow)
  })

  it('заменяет граф целиком при обновлении и двигает updatedAt', async () => {
    const repo = await repository()
    const workflow = await repo.create({ name: 'Ветвление', graph: BRANCHING_GRAPH })
    const trimmed = {
      nodes: BRANCHING_GRAPH.nodes.slice(0, 1),
      edges: [],
    }

    const updated = await repo.update(workflow.id, { name: 'Один промпт', graph: trimmed })

    expect(updated?.name).toBe('Один промпт')
    expect(updated?.graph).toEqual(trimmed)
    expect(updated?.createdAt).toBe(workflow.createdAt)
    expect(Date.parse(updated?.updatedAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(workflow.updatedAt),
    )
  })

  it('возвращает null на неизвестном идентификаторе', async () => {
    const repo = await repository()

    expect(await repo.findById('workflow_missing')).toBeNull()
    expect(await repo.update('workflow_missing', { name: 'x', graph: BRANCHING_GRAPH })).toBeNull()
    expect(await repo.remove('workflow_missing')).toBe(false)
  })

  it('перечисляет workflow от последнего изменённого к первому', async () => {
    const repo = await repository()
    const first = await repo.create({ name: 'Первый', graph: BRANCHING_GRAPH })
    const second = await repo.create({ name: 'Второй', graph: BRANCHING_GRAPH })
    await repo.update(first.id, { name: 'Первый, поправленный', graph: BRANCHING_GRAPH })

    expect((await repo.list()).map((workflow) => workflow.id)).toEqual([first.id, second.id])
  })

  it('удаляет workflow и сообщает, был ли он', async () => {
    const repo = await repository()
    const workflow = await repo.create({ name: 'Ветвление', graph: BRANCHING_GRAPH })

    expect(await repo.remove(workflow.id)).toBe(true)
    expect(await repo.findById(workflow.id)).toBeNull()
  })
})
