import { InMemoryPresetRepository } from '@workflow/core/testing'
import { afterAll, beforeAll, describe } from 'vitest'
import {
  createSteppingClock,
  describePresetRepositoryContract,
} from '../testing/preset-repository.contract.js'
import type { TestDatabase } from '../testing/test-database.js'
import { createTestDatabase, probeTestDatabase } from '../testing/test-database.js'
import { DrizzlePresetRepository } from './preset.repository.js'

const unavailable = await probeTestDatabase()

describe('InMemoryPresetRepository — эталон поведения', () => {
  describePresetRepositoryContract(() =>
    Promise.resolve(new InMemoryPresetRepository([], createSteppingClock())),
  )
})

describe.skipIf(unavailable !== null)(
  'DrizzlePresetRepository — тот же контракт на Postgres',
  () => {
    let database: TestDatabase | null = null

    beforeAll(async () => {
      database = await createTestDatabase('presets')
    })

    afterAll(async () => {
      await database?.close()
    })

    describePresetRepositoryContract(async () => {
      if (database === null) throw new Error('тестовая база не поднята')
      await database.truncate()
      return new DrizzlePresetRepository(database.db, createSteppingClock())
    })
  },
)
