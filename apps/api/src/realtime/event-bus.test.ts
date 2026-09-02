import type { Job, RunEvent } from '@workflow/contracts'
import { runEventChannel } from '@workflow/contracts'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestRedis, probeTestRedis } from '../testing/test-redis.js'
import { RedisRunEventBus, runHistoryKey } from './event-bus.js'

const REDIS_DB = 2

function job(nodeId: string, status: Job['status']): Job {
  return {
    id: `job-${nodeId}`,
    runId: 'run-1',
    nodeId,
    status,
    attempt: 1,
    startedAt: null,
    finishedAt: null,
    output: null,
    error:
      status === 'error'
        ? { code: 'PROVIDER_UNAVAILABLE', message: 'упал', retryable: true }
        : null,
  }
}

const skipReason = await probeTestRedis()

describe.skipIf(skipReason !== null)('RedisRunEventBus', () => {
  let redis: Redis
  let subscriber: Redis
  let bus: RedisRunEventBus

  beforeAll(() => {
    redis = createTestRedis(REDIS_DB)
    subscriber = createTestRedis(REDIS_DB)
    bus = new RedisRunEventBus({ redis, subscriber, historyLimit: 5 })
  })

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await bus.close()
    await redis.quit()
  })

  it('присваивает монотонный seq в пределах запуска', async () => {
    const first = await bus.publish({ type: 'run.started', runId: 'run-1', startedAt: iso() })
    const second = await bus.publish({
      type: 'job.updated',
      runId: 'run-1',
      job: job('a', 'running'),
    })
    // счётчик у каждого запуска свой
    const other = await bus.publish({ type: 'run.started', runId: 'run-2', startedAt: iso() })

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(other.seq).toBe(1)
  })

  it('доставляет события подписчику своего запуска и только его', async () => {
    const mine: RunEvent[] = []
    const subscription = await bus.subscribe('run-1', (event) => mine.push(event))

    await bus.publish({ type: 'run.started', runId: 'run-1', startedAt: iso() })
    await bus.publish({ type: 'run.started', runId: 'run-2', startedAt: iso() })
    await waitFor(() => mine.length === 1)

    expect(mine.map((event) => event.runId)).toEqual(['run-1'])

    await subscription.close()
    await bus.publish({ type: 'job.updated', runId: 'run-1', job: job('a', 'success') })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mine).toHaveLength(1)
  })

  it('история отдаётся с позиции и не очищается новыми событиями о падении и retry', async () => {
    await bus.publish({ type: 'run.started', runId: 'run-1', startedAt: iso() })
    await bus.publish({ type: 'job.updated', runId: 'run-1', job: job('a', 'error') })
    await bus.publish({ type: 'job.updated', runId: 'run-1', job: job('a', 'idle') })
    await bus.publish({ type: 'job.updated', runId: 'run-1', job: job('a', 'success') })

    const all = await bus.history('run-1', -1)
    expect(all.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    // поздний подписчик обязан увидеть, что нода падала, даже после успешного retry
    expect(
      all.filter((event) => event.type === 'job.updated' && event.job.status === 'error'),
    ).toHaveLength(1)

    const tail = await bus.history('run-1', 2)
    expect(tail.map((event) => event.seq)).toEqual([3, 4])
  })

  it('кольцевой буфер обрезает старое, а не растёт бесконечно', async () => {
    for (let i = 0; i < 8; i += 1) {
      await bus.publish({ type: 'job.updated', runId: 'run-1', job: job(`n${i}`, 'success') })
    }

    expect(await redis.llen(runHistoryKey('run-1'))).toBe(5)
    const kept = await bus.history('run-1', -1)
    expect(kept.map((event) => event.seq)).toEqual([4, 5, 6, 7, 8])
  })

  it('чужое сообщение в канале не роняет подписчиков', async () => {
    const invalid: string[] = []
    const received: RunEvent[] = []
    const noisy = new RedisRunEventBus({
      redis,
      subscriber: createTestRedis(REDIS_DB),
      onInvalidEvent: (raw) => invalid.push(raw),
    })
    const subscription = await noisy.subscribe('run-1', (event) => received.push(event))

    await redis.publish(runEventChannel('run-1'), 'не json')
    await noisy.publish({ type: 'run.started', runId: 'run-1', startedAt: iso() })
    await waitFor(() => received.length === 1)

    expect(invalid).toEqual(['не json'])
    expect(received).toHaveLength(1)

    await subscription.close()
    await noisy.close()
  })
})

const iso = (): string => new Date().toISOString()

async function waitFor(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('событие не пришло')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
