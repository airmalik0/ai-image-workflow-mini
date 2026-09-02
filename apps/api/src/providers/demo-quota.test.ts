import type { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestRedis, probeTestRedis } from '../testing/test-redis.js'
import { RedisDemoQuota, demoQuotaKey, nextMidnightUtc, readDemoQuota } from './demo-quota.js'

const REDIS_DB = 5

describe('ключ и срок жизни счётчика', () => {
  it('ключ — сутки в UTC, а не в местном времени стенда', () => {
    expect(demoQuotaKey(new Date('2026-09-02T23:30:00.000Z'))).toBe('demo:calls:2026-09-02')
    expect(demoQuotaKey(new Date('2026-09-03T00:30:00.000Z'))).toBe('demo:calls:2026-09-03')
  })

  it('счётчик истекает в ближайшую полночь UTC', () => {
    const deadline = nextMidnightUtc(new Date('2026-09-02T23:59:59.000Z'))

    expect(new Date(deadline * 1000).toISOString()).toBe('2026-09-03T00:00:00.000Z')
  })

  it('последний день месяца не ломает переход через границу', () => {
    const deadline = nextMidnightUtc(new Date('2026-12-31T12:00:00.000Z'))

    expect(new Date(deadline * 1000).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

const skipReason = await probeTestRedis()

describe.skipIf(skipReason !== null)('RedisDemoQuota', () => {
  let redis: Redis

  /**
   * Часы берутся от настоящего «сейчас», а не от даты-константы: `EXPIREAT`
   * ставит абсолютный момент, и захардкоженное «вчера» удаляло бы ключ сразу
   * после записи — тест начал бы падать на следующий день после написания.
   */
  const NOW = new Date()
  const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

  beforeAll(() => {
    redis = createTestRedis(REDIS_DB)
  })

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  const quota = (limit: number, at: Date = NOW) =>
    new RedisDemoQuota({ redis, limit, now: () => at })

  it('на пустом счётчике расход нулевой, а квота не исчерпана', async () => {
    expect(await readDemoQuota(quota(3))).toEqual({ limit: 3, used: 0, exhausted: false })
  })

  it('считает обращения и объявляет исчерпание по достижении потолка', async () => {
    const demo = quota(2)

    await demo.record()
    expect(await readDemoQuota(demo)).toEqual({ limit: 2, used: 1, exhausted: false })

    await demo.record()
    expect(await readDemoQuota(demo)).toEqual({ limit: 2, used: 2, exhausted: true })
  })

  it('ставит счётчику истечение ровно в ближайшую полночь UTC — иначе он жил бы вечно', async () => {
    await quota(5).record()

    const expireAt = await redis.call('EXPIRETIME', demoQuotaKey(NOW))
    expect(expireAt).toBe(nextMidnightUtc(NOW))
  })

  it('счётчик общий для процессов: воркер считает, API читает', async () => {
    await quota(4).record()

    expect(await quota(4).used()).toBe(1)
  })

  it('новые сутки начинаются с нуля: у каждого дня свой ключ', async () => {
    await quota(1).record()

    expect(await quota(1, TOMORROW).used()).toBe(0)
  })
})
