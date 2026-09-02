import { readFile } from 'node:fs/promises'

/**
 * Пропущенный тест в CI — это тест, которого нет. Интеграционные наборы этого
 * проекта сами снимаются с прогона, когда Postgres, Redis или MinIO недоступны:
 * локально это удобно, а в CI означало бы зелёную сборку, не проверившую
 * ни слой данных, ни очередь, ни хранилище. Поэтому число пропущенных сверяется
 * с нулём явно.
 */
const [report] = process.argv.slice(2)
if (report === undefined) {
  console.error('Использование: node scripts/ci/no-skipped-tests.mjs <отчёт vitest в json>')
  process.exit(2)
}

const {
  numPendingTests = 0,
  numTotalTests = 0,
  numPassedTests = 0,
} = JSON.parse(await readFile(report, 'utf8'))

if (numPendingTests > 0) {
  console.error(
    `Пропущено тестов: ${numPendingTests} из ${numTotalTests}. ` +
      'Скорее всего, не поднялись Postgres, Redis или MinIO — смотрите stderr прогона.',
  )
  process.exit(1)
}

console.log(`Пропущенных тестов нет: ${numPassedTests} из ${numTotalTests} прошли.`)
