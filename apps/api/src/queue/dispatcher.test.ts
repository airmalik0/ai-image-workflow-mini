import { workflowGraphSchema } from '@workflow/contracts'
import type { DispatchPayload } from '@workflow/core'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestRedis, probeTestRedis, testRedisUrl } from '../testing/test-redis.js'
import { BullMqDispatcher } from './dispatcher.js'
import {
  RUN_CANCEL_CHANNEL,
  createJobsQueue,
  redisConnection,
  runCancelledKey,
  runJobsKey,
} from './queue.js'

const REDIS_DB = 1

const node = workflowGraphSchema.parse({
  nodes: [{ id: 'g1', kind: 'generateImage', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
}).nodes[0]

function payload(runId: string, nodeId: string, attempt = 1): DispatchPayload {
  if (node === undefined) throw new Error('фикстура ноды не собралась')
  return {
    runId,
    jobId: `${runId}-${nodeId}`,
    nodeId,
    attempt,
    node: { ...node, id: nodeId },
    inputs: { prompt: { type: 'text', value: 'кот в скафандре' } },
  }
}

const skipReason = await probeTestRedis()

describe.skipIf(skipReason !== null)('BullMqDispatcher', () => {
  let redis: Redis
  let queue: Queue<DispatchPayload>
  let dispatcher: BullMqDispatcher

  beforeAll(() => {
    redis = createTestRedis(REDIS_DB)
    queue = createJobsQueue(redisConnection(testRedisUrl(REDIS_DB)))
    dispatcher = new BullMqDispatcher({ queue, redis })
  })

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await queue.close()
    await redis.quit()
  })

  it('ставит задание в очередь и не ждёт его исполнения', async () => {
    const started = Date.now()
    await dispatcher.dispatch(payload('run-1', 'g1'))

    // dispatch обязан возвращаться сразу: ожидание результата убило бы параллелизм
    expect(Date.now() - started).toBeLessThan(500)

    const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized'])
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.data).toMatchObject({ runId: 'run-1', nodeId: 'g1' })
    expect(waiting[0]?.opts.attempts).toBe(3)
    expect(waiting[0]?.opts.backoff).toEqual({ type: 'custom' })
    expect(await redis.smembers(runJobsKey('run-1'))).toEqual(['run-1~g1~1'])
  })

  it('повторная постановка той же попытки не удваивает задание', async () => {
    await dispatcher.dispatch(payload('run-2', 'g1'))
    await dispatcher.dispatch(payload('run-2', 'g1'))

    expect(await queue.getJobCountByTypes('waiting')).toBe(1)

    // ручной retry — это другая попытка, и она обязана пройти
    await dispatcher.dispatch(payload('run-2', 'g1', 2))
    expect(await queue.getJobCountByTypes('waiting')).toBe(2)
  })

  it('в идентификаторе задания нет двоеточия: BullMQ такие не принимает', async () => {
    await dispatcher.dispatch(payload('run:with:colons', 'node:1'))

    const [added] = await queue.getJobs(['waiting'])
    expect(added?.id).toBe('run%3Awith%3Acolons~node%3A1~1')
    expect(added?.id).not.toContain(':')
  })

  it('cancel снимает неначатое из очереди, ставит флаг и рассылает отмену', async () => {
    await dispatcher.dispatch(payload('run-3', 'g1'))
    await dispatcher.dispatch(payload('run-3', 'g2'))
    await dispatcher.dispatch(payload('run-4', 'g1'))

    const subscriber = createTestRedis(REDIS_DB)
    const broadcast = new Promise<string>((resolve) => {
      subscriber.on('message', (_channel: string, message: string) => {
        resolve(message)
      })
    })
    await subscriber.subscribe(RUN_CANCEL_CHANNEL)

    await dispatcher.cancel('run-3')

    expect(JSON.parse(await broadcast)).toEqual({ runId: 'run-3' })
    expect(await redis.get(runCancelledKey('run-3'))).toBe('1')
    // соседний запуск не задет
    expect(await redis.get(runCancelledKey('run-4'))).toBeNull()

    const left = await queue.getJobs(['waiting', 'delayed', 'prioritized'])
    expect(left.map((job) => job.data.runId)).toEqual(['run-4'])
    expect(await redis.smembers(runJobsKey('run-3'))).toEqual([])

    await subscriber.quit()
  })
})
