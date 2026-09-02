import { runStateSchema, workflowGraphSchema } from '@workflow/contracts'
import type { RunEvent, RunState, WorkflowGraph } from '@workflow/contracts'
import { FakeProvider } from '@workflow/core'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { InMemoryRunEventBus } from '../testing/in-memory-event-bus.js'
import { buildTestApp } from '../testing/build-test-app.js'

/** prompt → (a, b) → (ra, rb): обязательное ветвление из ТЗ. */
function branchingGraph(): WorkflowGraph {
  return workflowGraphSchema.parse({
    nodes: [
      { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот в скафандре' } },
      { id: 'a', kind: 'generateImage', position: { x: 200, y: -100 }, data: {} },
      { id: 'b', kind: 'generateImage', position: { x: 200, y: 100 }, data: {} },
      { id: 'ra', kind: 'result', position: { x: 400, y: -100 }, data: {} },
      { id: 'rb', kind: 'result', position: { x: 400, y: 100 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'p', sourceHandle: 'text', target: 'a', targetHandle: 'prompt' },
      { id: 'e2', source: 'p', sourceHandle: 'text', target: 'b', targetHandle: 'prompt' },
      { id: 'e3', source: 'a', sourceHandle: 'image', target: 'ra', targetHandle: 'image' },
      { id: 'e4', source: 'b', sourceHandle: 'image', target: 'rb', targetHandle: 'image' },
    ],
  })
}

/** Граф с циклом: валидатор обязан его отвергнуть. */
function cyclicGraph(): WorkflowGraph {
  return workflowGraphSchema.parse({
    nodes: [
      { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'круг' } },
      { id: 'g', kind: 'generateImage', position: { x: 200, y: 0 }, data: {} },
      { id: 'e', kind: 'editImage', position: { x: 400, y: 0 }, data: {} },
      { id: 'r', kind: 'result', position: { x: 600, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'p', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
      { id: 'e2', source: 'g', sourceHandle: 'image', target: 'e', targetHandle: 'image' },
      { id: 'e3', source: 'e', sourceHandle: 'image', target: 'g', targetHandle: 'prompt' },
      { id: 'e4', source: 'e', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
    ],
  })
}

const RUN_TIMEOUT_MS = 5_000

async function startRun(app: FastifyInstance, graph: WorkflowGraph): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { graph } })
  expect(response.statusCode).toBe(201)
  return (response.json() as { runId: string }).runId
}

async function readRun(app: FastifyInstance, runId: string): Promise<RunState> {
  const response = await app.inject({ method: 'GET', url: `/api/runs/${runId}` })
  expect(response.statusCode).toBe(200)
  return runStateSchema.parse(response.json())
}

/** Ожидание завершения: у роутов нет синхронного «дождись», и это правильно. */
async function waitForRun(
  app: FastifyInstance,
  runId: string,
  done: (state: RunState) => boolean,
): Promise<RunState> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  for (;;) {
    const state = await readRun(app, runId)
    if (done(state)) return state
    if (Date.now() > deadline) {
      throw new Error(`Запуск не дошёл до нужного состояния: ${JSON.stringify(state.run)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const isFinished = (state: RunState): boolean => state.run.status !== 'running'

const statusOf = (state: RunState, nodeId: string): string | undefined =>
  state.jobs.find((job) => job.nodeId === nodeId)?.status

describe('POST /api/runs', () => {
  it('исполняет граф ветвления: оба результата success', async () => {
    const app = buildTestApp()
    const runId = await startRun(app, branchingGraph())

    const state = await waitForRun(app, runId, isFinished)

    expect(state.run.status).toBe('completed')
    expect(state.jobs.map((job) => job.status)).toEqual([
      'success',
      'success',
      'success',
      'success',
      'success',
    ])
    for (const nodeId of ['ra', 'rb']) {
      expect(state.jobs.find((job) => job.nodeId === nodeId)?.output).toMatchObject({
        type: 'image',
      })
    }
    // картинка в поток не идёт: у результата только идентификатор файла
    const result = state.jobs.find((job) => job.nodeId === 'ra')?.output
    expect(result).toEqual({ type: 'image', fileId: expect.any(String) })

    await app.close()
  })

  it('невалидный граф — 400 GRAPH_INVALID, и run не создаётся', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { graph: cyclicGraph() },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { code: string; details: { errors: unknown[] } } }
    expect(body.error.code).toBe('GRAPH_INVALID')
    expect(body.error.details.errors.length).toBeGreaterThan(0)

    const history = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(history.json()).toEqual([])

    await app.close()
  })

  it('запускает сохранённый workflow по идентификатору', async () => {
    const app = buildTestApp()
    const saved = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Ветвление', graph: branchingGraph() },
    })
    const workflowId = (saved.json() as { id: string }).id

    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workflowId },
    })
    expect(response.statusCode).toBe(201)

    const runId = (response.json() as { runId: string }).runId
    const state = await waitForRun(app, runId, isFinished)
    expect(state.run.status).toBe('completed')
    expect(state.run.workflowId).toBe(workflowId)

    await app.close()
  })

  it('несуществующий workflow — 404, а не пустой запуск', async () => {
    const app = buildTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workflowId: 'нет-такого' },
    })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})

describe('события запуска', () => {
  it('шина получает run.started, job.updated и run.finished с возрастающим seq', async () => {
    const events = new InMemoryRunEventBus()
    const app = buildTestApp({ events })
    const runId = await startRun(app, branchingGraph())
    await waitForRun(app, runId, isFinished)
    await app.orchestrator.drainEvents()

    const published: RunEvent[] = events.published
    expect(published[0]?.type).toBe('run.started')
    expect(published.at(-1)).toMatchObject({ type: 'run.finished', status: 'completed' })
    expect(published.map((event) => event.seq)).toEqual(
      [...published].map((event) => event.seq).sort((a, b) => a - b),
    )
    expect(new Set(published.map((event) => event.seq)).size).toBe(published.length)

    await app.close()
  })
})

describe('POST /api/runs/:runId/nodes/:nodeId/retry', () => {
  it('перезапускает упавшую ноду и пересчитывает статус run’а по всем job’ам', async () => {
    const provider = new FakeProvider({ failNodes: ['b'] })
    const events = new InMemoryRunEventBus()
    const app = buildTestApp({ provider, events })

    const runId = await startRun(app, branchingGraph())
    const failed = await waitForRun(app, runId, isFinished)

    // падение одной ветки не мешает соседней дойти до конца
    expect(failed.run.status).toBe('failed')
    expect(statusOf(failed, 'a')).toBe('success')
    expect(statusOf(failed, 'ra')).toBe('success')
    expect(statusOf(failed, 'b')).toBe('error')
    expect(statusOf(failed, 'rb')).toBe('skipped')

    provider.setFailingNodes([])
    const retried = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/nodes/b/retry`,
    })
    expect(retried.statusCode).toBe(200)

    const done = await waitForRun(app, runId, isFinished)
    expect(done.run.status).toBe('completed')
    expect(statusOf(done, 'b')).toBe('success')
    expect(statusOf(done, 'rb')).toBe('success')
    // успешный предок не пересчитывался: провайдер вызван для «a» ровно один раз
    expect(provider.callsFor('a')).toBe(1)

    await app.orchestrator.drainEvents()
    // история не очищается retry'ем: поздний подписчик обязан узнать, что нода падала
    const history = await events.history(runId, -1)
    expect(
      history.some((event) => event.type === 'job.updated' && event.job.status === 'error'),
    ).toBe(true)

    await app.close()
  })

  it('пока хоть одна нода не выполнена, run не completed', async () => {
    const provider = new FakeProvider({ failNodes: ['a', 'b'] })
    const app = buildTestApp({ provider })

    const runId = await startRun(app, branchingGraph())
    await waitForRun(app, runId, isFinished)

    // чиним только одну ветку — вторая по-прежнему падает
    provider.setFailingNodes(['b'])
    await app.inject({ method: 'POST', url: `/api/runs/${runId}/nodes/a/retry` })
    const state = await waitForRun(app, runId, isFinished)

    expect(statusOf(state, 'a')).toBe('success')
    expect(statusOf(state, 'ra')).toBe('success')
    expect(state.run.status).toBe('failed')

    await app.close()
  })

  it('retry неизвестного запуска — 404, неизвестной ноды — 400', async () => {
    const app = buildTestApp()
    const runId = await startRun(app, branchingGraph())
    await waitForRun(app, runId, isFinished)

    const noRun = await app.inject({ method: 'POST', url: '/api/runs/нет/nodes/a/retry' })
    expect(noRun.statusCode).toBe(404)
    expect((noRun.json() as { error: { code: string } }).error.code).toBe('RUN_NOT_FOUND')

    const noNode = await app.inject({ method: 'POST', url: `/api/runs/${runId}/nodes/нет/retry` })
    expect(noNode.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/runs/:runId/cancel', () => {
  it('отменяет запуск: незавершённые ноды становятся skipped', async () => {
    // задержка нужна, чтобы успеть отменить: без неё граф закончится за один тик
    const provider = new FakeProvider({ latencyMs: 300 })
    const app = buildTestApp({ provider })

    const runId = await startRun(app, branchingGraph())
    const cancelled = await app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel` })

    expect(cancelled.statusCode).toBe(200)
    const state = runStateSchema.parse(cancelled.json())
    expect(state.run.status).toBe('cancelled')
    expect(state.jobs.filter((job) => job.status === 'skipped').length).toBeGreaterThan(0)

    // поздний ответ прерванной генерации не воскрешает отменённый запуск
    await new Promise((resolve) => setTimeout(resolve, 400))
    const after = await readRun(app, runId)
    expect(after.run.status).toBe('cancelled')
    expect(after.jobs.some((job) => job.status === 'running')).toBe(false)

    await app.close()
  })

  it('отмена неизвестного запуска — 404', async () => {
    const app = buildTestApp()
    const response = await app.inject({ method: 'POST', url: '/api/runs/нет-такого/cancel' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
