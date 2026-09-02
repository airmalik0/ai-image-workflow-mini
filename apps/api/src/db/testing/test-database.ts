import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { Database } from '../client.js'
import { createDatabase, runMigrations } from '../client.js'

/**
 * Адрес Postgres для тестов репозиториев. Локально поднимается контейнером
 * на нестандартном порту, чтобы не спорить с чужой базой на 5432:
 *
 * ```
 * docker run -d --name aiwf-test-pg -e POSTGRES_PASSWORD=postgres \
 *   -e POSTGRES_DB=workflow_test -p 55432:5432 postgres:17-alpine
 * ```
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/workflow_test'

export interface TestDatabase extends Database {
  name: string
  url: string
  /** Очистка между тестами: дешевле, чем заводить базу на каждый `it`. */
  truncate(): Promise<void>
}

/**
 * `null` — база доступна; строка — причина, по которой тесты придётся пропустить.
 *
 * Причина печатается сразу и в `process.stderr`, а не в `console.warn`:
 * vitest перехватывает консоль и привязывает вывод к задаче, а на этапе загрузки
 * модуля задачи ещё нет — сообщение бесследно теряется, и «22 пропущено»
 * остаётся без объяснения.
 */
export async function probeTestDatabase(): Promise<string | null> {
  const client = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    await client.query('select 1')
    await client.end()
    return null
  } catch (error) {
    await client.end().catch(() => undefined)
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `[db] тесты против Postgres пропущены — база недоступна: ${reason}\n` +
        '     Поднять: docker run -d --name aiwf-test-pg -e POSTGRES_PASSWORD=postgres ' +
        '-e POSTGRES_DB=workflow_test -p 55432:5432 postgres:17-alpine\n',
    )
    return reason
  }
}

/**
 * Каждому тестовому файлу — своя БАЗА, а не схема внутри общей.
 * Vitest гоняет файлы параллельно, и `TRUNCATE` в общей базе означал бы,
 * что соседний файл теряет свои данные посреди теста.
 */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  if (!/^[a-z0-9_]{1,24}$/.test(label)) throw new Error(`Недопустимая метка базы: «${label}»`)
  const name = `aiwf_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`

  await withAdmin(async (admin) => {
    await admin.query(`CREATE DATABASE "${name}"`)
  })

  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const database = createDatabase({ url: url.toString(), maxConnections: 4 })
  await runMigrations(database)

  return {
    ...database,
    name,
    url: url.toString(),
    truncate: async () => {
      await database.pool.query(
        'truncate table jobs, runs, workflows, presets, files restart identity cascade',
      )
    },
    close: async () => {
      await database.close()
      // FORCE отцепляет случайные висящие соединения: без него DROP ждёт вечно
      await withAdmin(async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      })
    },
  }
}

async function withAdmin(action: (client: Client) => Promise<void>): Promise<void> {
  const admin = new Client({ connectionString: TEST_DATABASE_URL })
  await admin.connect()
  try {
    await action(admin)
  } finally {
    await admin.end()
  }
}
