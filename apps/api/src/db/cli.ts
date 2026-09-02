import { fileURLToPath } from 'node:url'
import { createFileStorage, fileStorageConfigFromEnv } from '../storage/index.js'
import { createDatabase, runMigrations } from './client.js'
import { seedDatabase } from './seed.js'

/**
 * Команды обслуживания базы: `migrate`, `seed` и `setup` (обе подряд).
 * Контейнер API зовёт `setup` на старте — миграции и сид не должны требовать
 * ручного шага, иначе «docker compose up» из README не работает на чистой машине.
 */
async function main(command: string | undefined): Promise<void> {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') throw new Error('Не задана переменная DATABASE_URL')

  const database = createDatabase({ url })
  try {
    if (command === 'migrate' || command === 'setup') {
      await runMigrations(database)
      process.stdout.write('миграции применены\n')
    }
    if (command === 'seed' || command === 'setup') {
      const storage = createFileStorage(fileStorageConfigFromEnv())
      const result = await seedDatabase({ db: database.db, storage })
      process.stdout.write(
        `сид: пресетов добавлено ${String(result.presetsInserted)}, ` +
          `файлов добавлено ${String(result.filesInserted)}\n`,
      )
    }
    if (command !== 'migrate' && command !== 'seed' && command !== 'setup') {
      throw new Error(`Неизвестная команда «${String(command)}». Ожидались: migrate, seed, setup`)
    }
  } finally {
    await database.close()
  }
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
