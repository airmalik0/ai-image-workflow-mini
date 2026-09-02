import { defineConfig } from 'drizzle-kit'

/**
 * Конфиг drizzle-kit. Нужен только для `generate` (сборка SQL по схеме) и `studio`;
 * миграции в рантайме применяет `runMigrations()` из `src/db/client.ts`,
 * поэтому строка подключения здесь необязательна.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/workflow',
  },
})
