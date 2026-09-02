import {
  BullMqDispatcher,
  RedisRunEventBus,
  createJobsQueue,
  createOutcomesQueue,
  createOutcomesWorker,
  redisConnection,
} from '@workflow/api'
import type { JobOutcomeMessage } from '@workflow/api'
import {
  SseClient,
  buildTestApp,
  createTestRedis,
  probeTestRedis,
  testRedisUrl,
} from '@workflow/api/testing'
import { runStateSchema, workflowGraphSchema } from '@workflow/contracts'
import type { RunState, WorkflowGraph } from '@workflow/contracts'
import { FakeProvider } from '@workflow/core'
import {
  InMemoryFileStorage,
  InMemoryPresetRepository,
  InMemoryRunRepository,
} from '@workflow/core/testing'
import type { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RedisCancellation } from './cancellation.js'
import { createJobWorker } from './process-job.js'

const REDIS_DB = 4
const TIMEOUT_MS = 15_000

/** prompt → (a, b) → (ra, rb): ветвление из ТЗ, обе ветки независимы. */
const graph: WorkflowGraph = workflowGraphSchema.parse({
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

const skipReason = await probeTestRedis()

/**
 * Сквозной путь: HTTP → очередь → отдельный исполнитель → обратная очередь →
 * движок → шина → SSE. Здесь нет ни одной подделки, кроме провайдера картинок:
 * очередь настоящая, воркер — тот же, что уходит в контейнер.
 */
describe.skipIf(skipReason !== null)('API + worker через настоящий Redis', () => {
  let redis: Redis
  let bus: RedisRunEventBus
  let runs: InMemoryRunRepository
  let jobs: Queue
  let outcomesQueue: Queue<JobOutcomeMessage>
  let outcomesWorker: Worker<JobOutcomeMessage>
  let jobWorker: Worker
  let cancellation: RedisCancellation
  let provider: FakeProvider
  // тип берётся из сборщика, а не из fastify: воркеру веб-фреймворк не нужен
  let app: ReturnType<typeof buildTestApp>
  let base: string

  beforeAll(async () => {
    const url = testRedisUrl(REDIS_DB)
    redis = createTestRedis(REDIS_DB)
    await redis.flushdb()

    bus = new RedisRunEventBus({ redis, subscriber: createTestRedis(REDIS_DB) })
    runs = new InMemoryRunRepository()
    jobs = createJobsQueue(redisConnection(url))
    provider = new FakeProvider({ latencyMs: 400 })
    const storage = new InMemoryFileStorage()

    app = buildTestApp({
      runs,
      events: bus,
      files: storage,
      provider,
      dispatcher: new BullMqDispatcher({ queue: jobs, redis }),
    })
    base = await app.listen({ host: '127.0.0.1', port: 0 })

    outcomesQueue = createOutcomesQueue(redisConnection(url))
    outcomesWorker = createOutcomesWorker(redisConnection(url), (message) =>
      app.orchestrator.onJobFinished(message.runId, message.nodeId, message.outcome),
    )

    cancellation = new RedisCancellation({
      redis: createTestRedis(REDIS_DB),
      subscriber: createTestRedis(REDIS_DB),
    })
    await cancellation.start()

    jobWorker = createJobWorker({
      connection: redisConnection(url),
      concurrency: 2,
      execution: {
        providers: { forModel: () => provider },
        storage,
        presets: new InMemoryPresetRepository(),
      },
      outcomes: outcomesQueue,
      cancellation,
    })
    await jobWorker.waitUntilReady()
  }, TIMEOUT_MS)

  afterAll(async () => {
    await jobWorker.close()
    await outcomesWorker.close()
    await cancellation.close()
    await outcomesQueue.close()
    await jobs.close()
    await app.close()
    await bus.close()
    await redis.quit()
  }, TIMEOUT_MS)

  const start = async (): Promise<string> => {
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { runId: string }).runId
  }

  const state = async (runId: string): Promise<RunState> => {
    const response = await fetch(`${base}/api/runs/${runId}`)
    return runStateSchema.parse(await response.json())
  }

  const waitFor = async (
    runId: string,
    done: (value: RunState) => boolean,
    timeoutMs = TIMEOUT_MS,
  ): Promise<RunState> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const current = await state(runId)
      if (done(current)) return current
      if (Date.now() > deadline) throw new Error(`не дождались: ${JSON.stringify(current.run)}`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  it(
    'граф ветвления доходит до конца, и SSE отдаёт события всего пути',
    async () => {
      const runId = await start()
      const sse = await SseClient.open(`${base}/api/runs/${runId}/events`)

      const finished = await waitFor(runId, (value) => value.run.status !== 'running')

      expect(finished.run.status).toBe('completed')
      expect(finished.jobs.map((job) => job.status)).toEqual([
        'success',
        'success',
        'success',
        'success',
        'success',
      ])
      for (const nodeId of ['ra', 'rb']) {
        expect(finished.jobs.find((job) => job.nodeId === nodeId)?.output).toMatchObject({
          type: 'image',
        })
      }

      // поздний подписчик догоняет всё, включая события до своего подключения
      const events = await sse.waitForEvents(1)
      const seqs = events.map((event) => event.seq)
      expect(seqs).toEqual([...seqs].sort((left, right) => left - right))
      expect(
        sse.frames.filter((frame) => frame.data !== null).every((frame) => frame.id !== null),
      ).toBe(true)

      await sse.close()
    },
    TIMEOUT_MS,
  )

  it(
    'отмена прерывает работающую генерацию, а не только очередь',
    async () => {
      const abortedBefore = provider.aborted
      const callsBefore = provider.calls
      const runId = await start()

      // ждём не «оркестратор отдал задание», а «провайдер уже рисует»:
      // отменять надо именно работающую генерацию, иначе тест проверяет
      // только снятие очереди
      await waitUntil(() => provider.calls > callsBefore)

      const response = await fetch(`${base}/api/runs/${runId}/cancel`, { method: 'POST' })
      expect(response.status).toBe(200)

      const cancelled = runStateSchema.parse(await response.json())
      expect(cancelled.run.status).toBe('cancelled')

      await waitUntil(() => provider.aborted > abortedBefore)
      const after = await state(runId)
      expect(after.run.status).toBe('cancelled')
      expect(after.jobs.some((job) => job.status === 'running')).toBe(false)
    },
    TIMEOUT_MS,
  )
})

async function waitUntil(done: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('не дождались признака')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
