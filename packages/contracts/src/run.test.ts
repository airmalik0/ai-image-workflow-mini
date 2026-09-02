import { expect, it } from 'vitest'
import { jobStatuses, runStatuses, runEventSchema } from './index.js'

it('набор статусов job фиксирован', () => {
  expect(jobStatuses).toEqual(['idle', 'queued', 'running', 'success', 'error', 'skipped'])
})

it('набор статусов run фиксирован', () => {
  expect(runStatuses).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled'])
})

it('событие job.updated разбирается и несёт монотонный seq', () => {
  const parsed = runEventSchema.safeParse({
    seq: 1,
    runId: 'r1',
    type: 'job.updated',
    job: {
      id: 'j1',
      runId: 'r1',
      nodeId: 'n1',
      status: 'running',
      attempt: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: null,
      error: null,
    },
  })
  expect(parsed.success).toBe(true)
})
