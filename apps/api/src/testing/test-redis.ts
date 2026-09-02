import { Redis } from 'ioredis'

/**
 * Redis для тестов очереди и шины событий. Порт нестандартный, чтобы не спорить
 * с чужим Redis на 6379:
 *
 * ```
 * docker run -d --name aiwf-test-redis -p 56379:6379 redis:8-alpine
 * ```
 */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379'

/**
 * Своя база данных Redis на каждый тестовый файл: vitest гоняет файлы
 * параллельно, а `flushdb` в общей базе означал бы, что сосед теряет свои ключи
 * посреди теста.
 */
export function testRedisUrl(db: number): string {
  const url = new URL(TEST_REDIS_URL)
  url.pathname = `/${db}`
  return url.toString()
}

export function createTestRedis(db: number): Redis {
  return new Redis(testRedisUrl(db), { maxRetriesPerRequest: null })
}

/**
 * `null` — Redis доступен; строка — причина пропуска. Печатается в `process.stderr`
 * сразу: на этапе загрузки модуля задачи ещё нет, и `console.warn` бесследно
 * теряется внутри vitest.
 */
export async function probeTestRedis(): Promise<string | null> {
  const client = new Redis(TEST_REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: () => null,
    lazyConnect: true,
  })
  try {
    await client.connect()
    await client.ping()
    return null
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `[redis] тесты против Redis пропущены — сервер недоступен: ${reason}\n` +
        '     Поднять: docker run -d --name aiwf-test-redis -p 56379:6379 redis:8-alpine\n',
    )
    return reason
  } finally {
    client.disconnect()
  }
}
