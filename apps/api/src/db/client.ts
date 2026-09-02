import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { schema } from './schema.js'

export type Db = NodePgDatabase<typeof schema>

export interface DatabaseConfig {
  url: string
  maxConnections?: number
}

export interface Database {
  db: Db
  pool: Pool
  close(): Promise<void>
}

/**
 * Путь к миграциям одинаков и из `src`, и из `dist`: обе директории лежат
 * на одном уровне вложенности от корня пакета, поэтому подниматься надо на два шага.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConnections ?? 10,
  })

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  }
}

/**
 * Применяет миграции drizzle-kit.
 *
 * Изоляция тестов сделана отдельной БАЗОЙ, а не схемой внутри одной базы:
 * drizzle-kit жёстко прописывает `public` в `CREATE TYPE` и во внешних ключах,
 * поэтому в чужой схеме миграция либо упала бы на уже существующем типе,
 * либо сослалась бы на таблицы соседа.
 */
export async function runMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER })
}
