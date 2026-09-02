import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const FORBIDDEN = [
  'fastify',
  'drizzle-orm',
  'bullmq',
  'ioredis',
  'node:fs',
  'undici',
  '@google/genai',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

it('доменное ядро не зависит от инфраструктуры', () => {
  const offenders = walk(new URL('..', import.meta.url).pathname).filter((file) =>
    FORBIDDEN.some((dep) => readFileSync(file, 'utf8').includes(`from '${dep}`)),
  )
  expect(offenders).toEqual([])
})
