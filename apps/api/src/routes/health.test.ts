import { healthResponseSchema, modelsResponseSchema } from '@workflow/contracts'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/build-test-app.js'
import { InMemoryDemoQuota } from '../testing/in-memory-demo-quota.js'

describe('GET /api/health', () => {
  it('отдаёт 200 и тело { status, database, redis, provider }', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    const body = healthResponseSchema.parse(response.json())
    expect(body).toEqual({ status: 'ok', database: 'up', redis: 'down', provider: 'fake' })
    await app.close()
  })

  it('база недоступна — статус degraded, а не 500: health обязан отвечать и на больном стенде', async () => {
    const app = buildTestApp({ database: () => Promise.resolve(false) })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'down' })
    await app.close()
  })

  it('исключение из проверки базы — это тоже «down», а не падение эндпоинта', async () => {
    const app = buildTestApp({ database: () => Promise.reject(new Error('connection refused')) })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'down' })
    await app.close()
  })

  it('подключённый Redis попадает в ответ и в общий статус', async () => {
    const app = buildTestApp({ redis: () => Promise.resolve(true) })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.json()).toMatchObject({ status: 'ok', redis: 'up' })
    await app.close()
  })
})

describe('GET /api/health — предохранитель демо-стенда', () => {
  const demoEnv = { IMAGE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }

  it('без DEMO_DAILY_LIMIT признака нет: предохранитель выключен', async () => {
    const app = buildTestApp({ env: demoEnv })

    const body = healthResponseSchema.parse((await app.inject('/api/health')).json())

    expect(body.demo).toBeUndefined()
    expect(body.provider).toBe('openai')
    await app.close()
  })

  it('пока лимит не исчерпан, работает боевой провайдер, а расход объявлен', async () => {
    const app = buildTestApp({ env: demoEnv, demoQuota: new InMemoryDemoQuota(10, 3) })

    const body = healthResponseSchema.parse((await app.inject('/api/health')).json())

    expect(body.provider).toBe('openai')
    expect(body.demo).toEqual({ limit: 10, used: 3, exhausted: false })
    await app.close()
  })

  it('исчерпанный лимит объявляется, и провайдером назван fake', async () => {
    const app = buildTestApp({ env: demoEnv, demoQuota: new InMemoryDemoQuota(10, 10) })

    const body = healthResponseSchema.parse((await app.inject('/api/health')).json())

    expect(body.demo).toEqual({ limit: 10, used: 10, exhausted: true })
    // подмена объявлена, а не скрыта: иначе она ничем не отличалась бы от тихого отката
    expect(body.provider).toBe('fake')
    await app.close()
  })

  it('недоступный счётчик не роняет health и не выдумывает остаток', async () => {
    const broken = {
      limit: 5,
      used: () => Promise.reject(new Error('redis недоступен')),
      record: () => Promise.resolve(),
    }
    const app = buildTestApp({ env: demoEnv, demoQuota: broken })

    const response = await app.inject('/api/health')

    expect(response.statusCode).toBe(200)
    expect(healthResponseSchema.parse(response.json()).demo).toBeUndefined()
    await app.close()
  })
})

describe('GET /api/models', () => {
  it('отдаёт модели поднятых провайдеров с указанием провайдера у каждой', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/models' })

    expect(response.statusCode).toBe(200)
    const body = modelsResponseSchema.parse(response.json())
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.models.every((model) => model.providerId.length > 0)).toBe(true)
    await app.close()
  })
})
