import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_MAX_UPLOAD_BYTES, loadConfig } from './config.js'

describe('loadConfig', () => {
  it('поднимается на пустом окружении: приложение обязано работать без единой настройки', () => {
    const config = loadConfig({})

    expect(config.env).toBe('development')
    expect(config.port).toBe(3000)
    expect(config.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(config.redisUrl).toBe('redis://localhost:6379')
    expect(config.storage).toEqual({ driver: 'fs', dataDir: './data/files' })
    expect(config.provider.IMAGE_PROVIDER).toBeUndefined()
  })

  it('читает числа из строк окружения', () => {
    const config = loadConfig({
      PORT: '8080',
      MAX_UPLOAD_BYTES: '1024',
      MAX_CONCURRENT_JOBS: '8',
      WORKER_CONCURRENCY: '2',
    })

    expect(config.port).toBe(8080)
    expect(config.maxUploadBytes).toBe(1024)
    expect(config.maxConcurrentJobs).toBe(8)
    expect(config.workerConcurrency).toBe(2)
  })

  it('пустая строка — это «не задано», а не значение', () => {
    const config = loadConfig({ PORT: '', REDIS_URL: '   ', GEMINI_API_KEY: '' })

    expect(config.port).toBe(3000)
    expect(config.redisUrl).toBe('redis://localhost:6379')
    expect(config.provider.GEMINI_API_KEY).toBeUndefined()
  })

  it('падает на неверном PORT и называет переменную', () => {
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(ConfigError)
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(/PORT/)
  })

  it('падает на отрицательном лимите загрузки', () => {
    expect(() => loadConfig({ MAX_UPLOAD_BYTES: '-1' })).toThrow(/MAX_UPLOAD_BYTES/)
  })

  it('перечисляет сразу все неверные переменные, а не первую попавшуюся', () => {
    let message = ''
    try {
      loadConfig({ PORT: '0', LOG_LEVEL: 'громко' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/PORT/)
    expect(message).toMatch(/LOG_LEVEL/)
  })

  it('ошибка конфигурации файлового хранилища попадает в тот же конверт', () => {
    expect(() => loadConfig({ STORAGE_DRIVER: 's3' })).toThrow(ConfigError)
  })

  it('переменные провайдера передаются реестру как есть', () => {
    const config = loadConfig({ IMAGE_PROVIDER: 'fake', GEMINI_MODEL: 'gemini-3.1-flash-image' })

    expect(config.provider).toMatchObject({
      IMAGE_PROVIDER: 'fake',
      GEMINI_MODEL: 'gemini-3.1-flash-image',
    })
  })

  it('FAKE_FAIL_NODES доезжает до реестра провайдеров', () => {
    const config = loadConfig({ IMAGE_PROVIDER: 'fake', FAKE_FAIL_NODES: 'generateImage-1' })

    expect(config.provider.FAKE_FAIL_NODES).toBe('generateImage-1')
  })

  it('CORS_ORIGIN разбирается в список источников', () => {
    expect(loadConfig({}).corsOrigin).toBe(true)
    expect(
      loadConfig({ CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173' }).corsOrigin,
    ).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
  })
})
