import type { Job, WorkflowGraph } from '@workflow/contracts'
import type { RunRepository } from '@workflow/core'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Обязательное ветвление из ТЗ: один промпт кормит две независимые генерации.
 * Ноды перечислены НЕ в алфавитном порядке — так тест на порядок `listJobs`
 * действительно проверяет порядок вставки, а не случайное совпадение с сортировкой.
 */
export const BRANCHING_GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'prompt', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот в скафандре' } },
    {
      id: 'gen-b',
      kind: 'generateImage',
      position: { x: 200, y: 120 },
      data: { presetId: null, model: null, aspectRatio: '1:1' },
    },
    {
      id: 'gen-a',
      kind: 'generateImage',
      position: { x: 200, y: -120 },
      data: { presetId: 'preset_premium_3d', model: null, aspectRatio: '3:4' },
    },
    { id: 'result-b', kind: 'result', position: { x: 400, y: 120 }, data: {} },
    { id: 'result-a', kind: 'result', position: { x: 400, y: -120 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'prompt', sourceHandle: 'text', target: 'gen-b', targetHandle: 'prompt' },
    { id: 'e2', source: 'prompt', sourceHandle: 'text', target: 'gen-a', targetHandle: 'prompt' },
    { id: 'e3', source: 'gen-b', sourceHandle: 'image', target: 'result-b', targetHandle: 'image' },
    { id: 'e4', source: 'gen-a', sourceHandle: 'image', target: 'result-a', targetHandle: 'image' },
  ],
}

const NODE_IDS = BRANCHING_GRAPH.nodes.map((node) => node.id)

/**
 * Ловит ошибку, брошенную и синхронно, и через отклонённый промис.
 * Ин-мемори реализация бросает `DomainError` синхронно (метод не `async`),
 * а Drizzle — отклонённым промисом; для контракта это одно и то же поведение.
 */
async function failure(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('ожидалась ошибка, но вызов завершился успешно')
}

function byNode(jobs: readonly Job[], nodeId: string): Job {
  const job = jobs.find((candidate) => candidate.nodeId === nodeId)
  if (!job) throw new Error(`в списке нет job'а для ноды «${nodeId}»`)
  return job
}

/**
 * Поведенческий контракт `RunRepository`. Один и тот же набор прогоняется
 * и против ин-мемори эталона из `@workflow/core/testing`, и против реализации
 * на Drizzle: расхождение между ними — это баг, который иначе всплыл бы только
 * в проде, где движок работает уже поверх Postgres.
 */
export function describeRunRepositoryContract(create: () => Promise<RunRepository>): void {
  let repo: RunRepository

  beforeEach(async () => {
    repo = await create()
  })

  describe('createRun / findRun / listRuns', () => {
    it('создаёт запуск в статусе queued без отметок времени и без job’ов', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })

      expect(run.status).toBe('queued')
      expect(run.workflowId).toBeNull()
      expect(run.startedAt).toBeNull()
      expect(run.finishedAt).toBeNull()
      expect(new Date(run.createdAt).getTime()).not.toBeNaN()
      expect(await repo.listJobs(run.id)).toEqual([])
    })

    it('хранит снимок графа целиком, а не ссылку на workflow', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const found = await repo.findRun(run.id)

      expect(found?.graph).toEqual(BRANCHING_GRAPH)
    })

    it('возвращает null по неизвестному идентификатору', async () => {
      expect(await repo.findRun('run_missing')).toBeNull()
    })

    it('отдаёт последние запуски первыми и соблюдает лимит', async () => {
      const first = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const second = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const third = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })

      expect((await repo.listRuns(10)).map((run) => run.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ])
      expect((await repo.listRuns(2)).map((run) => run.id)).toEqual([third.id, second.id])
    })
  })

  describe('updateRun', () => {
    it('меняет только переданные поля', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const started = await repo.updateRun(run.id, {
        status: 'running',
        startedAt: '2026-09-02T10:00:00.000Z',
      })

      expect(started.status).toBe('running')
      expect(started.startedAt).toBe('2026-09-02T10:00:00.000Z')
      expect(started.finishedAt).toBeNull()
      expect(started.createdAt).toBe(run.createdAt)

      const failed = await repo.updateRun(run.id, { status: 'failed' })
      expect(failed.startedAt).toBe('2026-09-02T10:00:00.000Z')
    })

    it('падает на неизвестном запуске', async () => {
      const error = await failure(() => repo.updateRun('run_missing', { status: 'failed' }))

      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('run_missing')
    })

    it('обнуляет finishedAt явным null — этим пользуется retry завершённого запуска', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.updateRun(run.id, { status: 'failed', finishedAt: '2026-09-02T11:00:00.000Z' })

      const reopened = await repo.updateRun(run.id, { status: 'running', finishedAt: null })

      expect(reopened.status).toBe('running')
      expect(reopened.finishedAt).toBeNull()
    })
  })

  describe('ensureJobs', () => {
    it('заводит job на каждую ноду графа в статусе idle', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const jobs = await repo.ensureJobs(run.id, NODE_IDS)

      expect(jobs).toHaveLength(NODE_IDS.length)
      expect(jobs.map((job) => job.nodeId)).toEqual(NODE_IDS)
      for (const job of jobs) {
        expect(job.status).toBe('idle')
        expect(job.attempt).toBe(0)
        expect(job.runId).toBe(run.id)
        expect(job.output).toBeNull()
        expect(job.error).toBeNull()
        expect(job.startedAt).toBeNull()
        expect(job.finishedAt).toBeNull()
      }
    })

    it('идемпотентен: повторный вызов не плодит job’ы и не сбрасывает прогресс', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const created = await repo.ensureJobs(run.id, NODE_IDS)
      await repo.updateJob(run.id, 'prompt', {
        status: 'success',
        attempt: 1,
        output: { type: 'text', value: 'кот в скафандре' },
      })

      const again = await repo.ensureJobs(run.id, NODE_IDS)

      expect(again).toHaveLength(NODE_IDS.length)
      expect(again.map((job) => job.id)).toEqual(created.map((job) => job.id))
      expect(byNode(again, 'prompt').status).toBe('success')
      expect(byNode(again, 'prompt').attempt).toBe(1)
      expect(byNode(again, 'prompt').output).toEqual({ type: 'text', value: 'кот в скафандре' })
    })

    it('дозаводит недостающие ноды, не трогая существующие', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, ['prompt'])
      await repo.updateJob(run.id, 'prompt', { status: 'running' })

      const jobs = await repo.ensureJobs(run.id, NODE_IDS)

      expect(jobs).toHaveLength(NODE_IDS.length)
      expect(byNode(jobs, 'prompt').status).toBe('running')
      expect(byNode(jobs, 'gen-a').status).toBe('idle')
    })

    it('на пустом списке нод ничего не делает', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })

      expect(await repo.ensureJobs(run.id, [])).toEqual([])
    })
  })

  describe('updateJob', () => {
    it('меняет только переданные поля', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)

      const running = await repo.updateJob(run.id, 'gen-a', {
        status: 'running',
        attempt: 1,
        startedAt: '2026-09-02T12:00:00.000Z',
      })
      expect(running.status).toBe('running')
      expect(running.attempt).toBe(1)
      expect(running.startedAt).toBe('2026-09-02T12:00:00.000Z')

      const finished = await repo.updateJob(run.id, 'gen-a', { status: 'success' })
      expect(finished.attempt).toBe(1)
      expect(finished.startedAt).toBe('2026-09-02T12:00:00.000Z')
      expect(finished.id).toBe(running.id)
    })

    it('пустой патч оставляет job как есть', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)
      const before = await repo.updateJob(run.id, 'gen-a', { status: 'running', attempt: 2 })

      expect(await repo.updateJob(run.id, 'gen-a', {})).toEqual(before)
    })

    it('обнуляет output, error, startedAt и finishedAt явным null — сценарий retry', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)
      await repo.updateJob(run.id, 'gen-a', {
        status: 'error',
        attempt: 1,
        startedAt: '2026-09-02T12:00:00.000Z',
        finishedAt: '2026-09-02T12:00:10.000Z',
        output: { type: 'image', fileId: 'file-1' },
        error: { code: 'PROVIDER_RATE_LIMITED', message: 'квота', retryable: true },
      })

      const reset = await repo.updateJob(run.id, 'gen-a', {
        status: 'idle',
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })

      expect(reset.status).toBe('idle')
      expect(reset.output).toBeNull()
      expect(reset.error).toBeNull()
      expect(reset.startedAt).toBeNull()
      expect(reset.finishedAt).toBeNull()
      // счётчик попыток retry сознательно НЕ сбрасывает: это история, а не состояние
      expect(reset.attempt).toBe(1)
      expect(byNode(await repo.listJobs(run.id), 'gen-a')).toEqual(reset)
    })

    it('хранит output и error целиком, а не по полям', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)

      const withImage = await repo.updateJob(run.id, 'gen-a', {
        status: 'success',
        output: { type: 'image', fileId: 'file-abc' },
      })
      expect(withImage.output).toEqual({ type: 'image', fileId: 'file-abc' })

      const withError = await repo.updateJob(run.id, 'gen-b', {
        status: 'error',
        error: { code: 'PROVIDER_SAFETY_BLOCKED', message: 'отказ модели', retryable: false },
      })
      expect(withError.error).toEqual({
        code: 'PROVIDER_SAFETY_BLOCKED',
        message: 'отказ модели',
        retryable: false,
      })
    })

    it('падает на неизвестной ноде, а не создаёт job молча', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)

      const error = await failure(() =>
        repo.updateJob(run.id, 'no-such-node', { status: 'running' }),
      )

      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('no-such-node')
      expect(await repo.listJobs(run.id)).toHaveLength(NODE_IDS.length)
    })
  })

  describe('listJobs', () => {
    it('сохраняет порядок нод графа, в том числе после retry', async () => {
      const run = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(run.id, NODE_IDS)

      for (const nodeId of NODE_IDS) {
        await repo.updateJob(run.id, nodeId, { status: 'success', attempt: 1 })
      }
      await repo.updateJob(run.id, 'gen-a', {
        status: 'idle',
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })

      // порядок значим: движок отдаёт исполнителю первые готовые job'ы из этого списка,
      // пока не кончатся слоты конкурентности
      expect((await repo.listJobs(run.id)).map((job) => job.nodeId)).toEqual(NODE_IDS)
    })

    it('не смешивает job’ы разных запусков', async () => {
      const first = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      const second = await repo.createRun({ workflowId: null, graph: BRANCHING_GRAPH })
      await repo.ensureJobs(first.id, NODE_IDS)
      await repo.ensureJobs(second.id, ['prompt'])

      expect(await repo.listJobs(first.id)).toHaveLength(NODE_IDS.length)
      expect(await repo.listJobs(second.id)).toHaveLength(1)
      expect((await repo.listJobs(second.id)).map((job) => job.runId)).toEqual([second.id])
    })

    it('на неизвестном запуске отдаёт пустой список', async () => {
      expect(await repo.listJobs('run_missing')).toEqual([])
    })
  })
}
