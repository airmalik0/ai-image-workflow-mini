import { InMemoryRunRepository } from '@workflow/core/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  describeRunRepositoryContract,
  BRANCHING_GRAPH,
} from '../testing/run-repository.contract.js'
import type { TestDatabase } from '../testing/test-database.js'
import { createTestDatabase, probeTestDatabase } from '../testing/test-database.js'
import { newId } from '../ids.js'
import { workflows } from '../schema.js'
import { DrizzleRunRepository } from './run.repository.js'

const unavailable = await probeTestDatabase()

describe('InMemoryRunRepository — эталон поведения', () => {
  describeRunRepositoryContract(() => Promise.resolve(new InMemoryRunRepository()))
})

describe.skipIf(unavailable !== null)('DrizzleRunRepository — тот же контракт на Postgres', () => {
  let database: TestDatabase | null = null

  beforeAll(async () => {
    database = await createTestDatabase('runs')
  })

  afterAll(async () => {
    await database?.close()
  })

  function required(): TestDatabase {
    if (database === null) throw new Error('тестовая база не поднята')
    return database
  }

  describeRunRepositoryContract(async () => {
    const testDatabase = required()
    await testDatabase.truncate()
    return new DrizzleRunRepository(testDatabase.db)
  })

  describe('поведение, которого нет у ин-мемори реализации', () => {
    it('уникальный индекс (run_id, node_id) не даёт завести второй job на ту же ноду', async () => {
      const testDatabase = required()
      await testDatabase.truncate()
      const repo = new DrizzleRunRepository(testDatabase.db)
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const nodeIds = BRANCHING_GRAPH.nodes.map((node) => node.id)

      // гонка: два одновременных ensureJobs — ровно то, что случается при
      // повторной постановке запуска после перезапуска API
      const [first, second] = await Promise.all([
        repo.ensureJobs(run.id, nodeIds),
        repo.ensureJobs(run.id, nodeIds),
      ])

      expect(first).toHaveLength(nodeIds.length)
      expect(second).toHaveLength(nodeIds.length)
      const rows = await testDatabase.pool.query<{ count: string }>(
        'select count(*)::text as count from jobs where run_id = $1',
        [run.id],
      )
      expect(rows.rows[0]?.count).toBe(String(nodeIds.length))
    })

    it('удаление запуска уносит его job’ы каскадом', async () => {
      const testDatabase = required()
      await testDatabase.truncate()
      const repo = new DrizzleRunRepository(testDatabase.db)
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(
        run.id,
        BRANCHING_GRAPH.nodes.map((node) => node.id),
      )

      await testDatabase.pool.query('delete from runs where id = $1', [run.id])

      const rows = await testDatabase.pool.query<{ count: string }>(
        'select count(*)::text as count from jobs where run_id = $1',
        [run.id],
      )
      expect(rows.rows[0]?.count).toBe('0')
    })

    it('удаление workflow оставляет запуск живым и обнуляет ссылку', async () => {
      const testDatabase = required()
      await testDatabase.truncate()
      const repo = new DrizzleRunRepository(testDatabase.db)
      const workflowId = newId('workflow')
      await testDatabase.db
        .insert(workflows)
        .values({ id: workflowId, name: 'Ветвление', graph: BRANCHING_GRAPH })
      const run = await repo.createRun({ workflowId, graph: BRANCHING_GRAPH })

      await testDatabase.pool.query('delete from workflows where id = $1', [workflowId])

      const found = await repo.findRun(run.id)
      expect(found?.workflowId).toBeNull()
      expect(found?.graph).toEqual(BRANCHING_GRAPH)
    })
  })
})
