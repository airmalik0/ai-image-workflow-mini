import { workflowGraphSchema } from '@workflow/contracts'
import type { Job, WorkflowGraph } from '@workflow/contracts'
import { InMemoryRunRepository } from '@workflow/core/testing'
import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/build-test-app.js'
import { SseClient } from '../testing/sse-client.js'
import { createTestRedis, probeTestRedis } from '../testing/test-redis.js'
import { RedisRunEventBus } from './event-bus.js'
import { sseRoutes } from './sse.js'

const REDIS_DB = 3

const graph: WorkflowGraph = workflowGraphSchema.parse({
  nodes: [
    { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот' } },
    { id: 'g', kind: 'generateImage', position: { x: 200, y: 0 }, data: {} },
    { id: 'r', kind: 'result', position: { x: 400, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'p', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
    { id: 'e2', source: 'g', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
  ],
})

function job(runId: string, status: Job['status']): Job {
  return {
    id: 'job-g',
    runId,
    nodeId: 'g',
    status,
    attempt: 1,
    startedAt: null,
    finishedAt: null,
    output: status === 'success' ? { type: 'image', fileId: 'file-1' } : null,
    error:
      status === 'error'
        ? { code: 'PROVIDER_UNAVAILABLE', message: 'провайдер упал', retryable: true }
        : null,
  }
}

const skipReason = await probeTestRedis()

describe.skipIf(skipReason !== null)('GET /api/runs/:runId/events', () => {
  let redis: Redis
  let bus: RedisRunEventBus
  let runs: InMemoryRunRepository
  let app: FastifyInstance
  let base: string
  let runId: string
  const clients: SseClient[] = []

  beforeAll(async () => {
    redis = createTestRedis(REDIS_DB)
    await redis.flushdb()
    bus = new RedisRunEventBus({ redis, subscriber: createTestRedis(REDIS_DB) })
    runs = new InMemoryRunRepository()
    app = buildTestApp({ runs, events: bus })
    // тот же обработчик с коротким пульсом: проверять heartbeat 15-секундным
    // ожиданием бессмысленно, а не проверять — значит поверить на слово
    await app.register(sseRoutes, { prefix: '/api/fast', heartbeatMs: 50 })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    runId = (await runs.createRun({ workflowId: null, graph })).id
  })

  afterEach(async () => {
    while (clients.length > 0) await clients.pop()?.close()
  })

  afterAll(async () => {
    await app.close()
    await bus.close()
    await redis.quit()
  })

  const open = async (path: string, headers?: Record<string, string>): Promise<SseClient> => {
    const client = await SseClient.open(`${base}${path}`, headers)
    clients.push(client)
    return client
  }

  it('живые события приходят в порядке возрастания seq, и у каждого кадра есть id', async () => {
    const client = await open(`/api/runs/${runId}/events`)

    await bus.publish({ type: 'run.started', runId, startedAt: new Date().toISOString() })
    await bus.publish({ type: 'job.updated', runId, job: job(runId, 'running') })
    await bus.publish({ type: 'job.updated', runId, job: job(runId, 'success') })

    const events = await client.waitForEvents(3)
    const seqs = events.map((event) => event.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(events.map((event) => event.type)).toEqual(['run.started', 'job.updated', 'job.updated'])

    // без поля id браузер не пришлёт Last-Event-ID, и докачка существует только на бумаге
    const dataFrames = client.frames.filter((frame) => frame.data !== null)
    expect(dataFrames.map((frame) => frame.id)).toEqual(seqs.map(String))

    // картинка в поток не идёт — только идентификатор файла
    expect(JSON.stringify(events)).not.toContain('data:image')
  })

  it('переподключение с заголовком Last-Event-ID не теряет и не дублирует события', async () => {
    const first = await bus.publish({
      type: 'run.started',
      runId,
      startedAt: new Date().toISOString(),
    })
    const second = await bus.publish({ type: 'job.updated', runId, job: job(runId, 'running') })
    const third = await bus.publish({ type: 'job.updated', runId, job: job(runId, 'success') })

    const client = await open(`/api/runs/${runId}/events`, { 'last-event-id': String(first.seq) })
    const events = await client.waitForEvents(2)

    expect(events.map((event) => event.seq)).toEqual([second.seq, third.seq])
    expect(events).toHaveLength(2)
  })

  it('переподключение с ?lastEventId= даёт тот же результат: у EventSource заголовка нет', async () => {
    const first = await bus.publish({
      type: 'run.started',
      runId,
      startedAt: new Date().toISOString(),
    })
    const second = await bus.publish({ type: 'job.updated', runId, job: job(runId, 'success') })

    const client = await open(`/api/runs/${runId}/events?lastEventId=${first.seq}`)
    const events = await client.waitForEvents(1)

    expect(events.map((event) => event.seq)).toEqual([second.seq])

    // и живые события после докачки приходят следом, без разрыва в нумерации
    const third = await bus.publish({
      type: 'run.finished',
      runId,
      status: 'completed',
      finishedAt: new Date().toISOString(),
    })
    const all = await client.waitForEvents(2)
    expect(all.map((event) => event.seq)).toEqual([second.seq, third.seq])
  })

  it('после retry история прошлых событий сохраняется: поздний подписчик видит падение', async () => {
    await bus.publish({ type: 'job.updated', runId, job: job(runId, 'error') })
    await bus.publish({ type: 'job.updated', runId, job: job(runId, 'idle') })
    await bus.publish({ type: 'job.updated', runId, job: job(runId, 'success') })

    const client = await open(`/api/runs/${runId}/events`)
    const events = await client.waitForEvents(3)

    const failure = events.find(
      (event) => event.type === 'job.updated' && event.job.status === 'error',
    )
    expect(failure).toBeDefined()
    expect(events.at(-1)).toMatchObject({ type: 'job.updated' })
  })

  it('пульс идёт комментарием, чтобы соединение не срезал таймаут простоя', async () => {
    const client = await open(`/api/fast/runs/${runId}/events`)
    await client.waitForComment()

    expect(client.frames.some((frame) => frame.comment === 'ping')).toBe(true)
  })

  it('неизвестный запуск — 404 в конверте ошибки, а не пустой поток', async () => {
    const response = await fetch(`${base}/api/runs/нет-такого/events`)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('RUN_NOT_FOUND')
  })
})
