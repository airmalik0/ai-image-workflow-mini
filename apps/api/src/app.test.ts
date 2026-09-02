import { Writable } from 'node:stream'
import { errorEnvelopeSchema } from '@workflow/contracts'
import { DomainError } from '@workflow/core'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './testing/build-test-app.js'

describe('конверт ошибок', () => {
  it('несуществующий маршрут — 404 в общем конверте, а не в формате Fastify', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/нет-такого' })

    expect(response.statusCode).toBe(404)
    const body = errorEnvelopeSchema.parse(response.json())
    expect(body.error.code).toBe('ROUTE_NOT_FOUND')
    await app.close()
  })

  it('доменная ошибка приезжает своим кодом и своим статусом', async () => {
    const app = buildTestApp()
    app.get('/boom-domain', () => {
      throw new DomainError('FILE_NOT_FOUND', 'Файл «abc» не найден')
    })

    const response = await app.inject({ method: 'GET', url: '/boom-domain' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: { code: 'FILE_NOT_FOUND', message: 'Файл «abc» не найден' },
    })
    await app.close()
  })

  it('неожиданная ошибка — 500 без текста наружу: в нём бывают строки подключения', async () => {
    const app = buildTestApp()
    app.get('/boom', () => {
      throw new Error('postgresql://postgres:hunter2@10.0.0.5/prod недоступен')
    })

    const response = await app.inject({ method: 'GET', url: '/boom' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
    })
    expect(response.body).not.toContain('hunter2')
    await app.close()
  })
})

describe('структурные логи', () => {
  it('runId и jobId из маршрута попадают в каждую строку лога запроса', async () => {
    const lines: Record<string, unknown>[] = []
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>)
        done()
      },
    })

    const app = buildTestApp({ logger: { level: 'info', stream } })
    app.get('/api/runs/:runId/jobs/:jobId/probe', (request) => {
      request.log.info('нода взята в работу')
      return { ok: true }
    })

    await app.inject({ method: 'GET', url: '/api/runs/run_42/jobs/job_7/probe' })
    await app.close()

    const own = lines.filter((line) => line.msg === 'нода взята в работу')
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ runId: 'run_42', jobId: 'job_7' })
  })

  it('у запроса есть идентификатор, и он берётся из заголовка, если пришёл', async () => {
    const lines: Record<string, unknown>[] = []
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>)
        done()
      },
    })

    const app = buildTestApp({ logger: { level: 'info', stream } })
    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'req-из-заголовка' },
    })
    await app.close()

    expect(lines.some((line) => line.reqId === 'req-из-заголовка')).toBe(true)
  })
})

describe('OpenAPI', () => {
  it('спека генерируется из zod-схем и отдаётся на /api/docs/json', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/docs/json' })

    expect(response.statusCode).toBe(200)
    const spec = response.json() as {
      openapi: string
      paths: Record<string, Record<string, unknown>>
    }
    expect(spec.openapi.startsWith('3.')).toBe(true)
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/files',
      '/api/files/{id}',
      '/api/health',
      '/api/models',
      '/api/presets',
      '/api/presets/{id}',
      '/api/runs',
      '/api/runs/{runId}',
      '/api/runs/{runId}/cancel',
      '/api/runs/{runId}/events',
      '/api/runs/{runId}/nodes/{nodeId}/retry',
      '/api/workflows',
      '/api/workflows/validate',
      '/api/workflows/{id}',
      // /api/ws в спеку не попадает: @fastify/swagger не описывает маршруты
      // с апгрейдом протокола. Он документирован в описании SSE-маршрута
    ])

    const health = spec.paths['/api/health']?.get as {
      responses: {
        '200': {
          content: {
            'application/json': { schema: { properties: object; required: string[] } }
          }
        }
      }
    }
    // поля взяты из healthResponseSchema, а не переписаны руками
    const healthSchema = health.responses['200'].content['application/json'].schema
    expect(Object.keys(healthSchema.properties)).toEqual([
      'status',
      'database',
      'redis',
      'provider',
      'demo',
    ])
    // предохранитель демо-стенда включается не всегда, поэтому поле необязательное
    expect(healthSchema.required).not.toContain('demo')
    await app.close()
  })

  it('страница документации открывается на /api/docs', async () => {
    const app = buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/docs' })

    expect([200, 302]).toContain(response.statusCode)
    await app.close()
  })
})
