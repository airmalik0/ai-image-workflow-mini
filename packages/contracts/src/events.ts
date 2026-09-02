import { z } from 'zod'
import { jobSchema, runStatusSchema } from './run.js'

/**
 * seq монотонно растёт в пределах одного run'а — по нему клиент догоняет
 * пропущенное после переподключения (SSE Last-Event-ID).
 */
const eventBase = {
  seq: z.number().int().nonnegative(),
  runId: z.string().min(1),
}

export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.started'), startedAt: z.iso.datetime() }),
  z.object({ ...eventBase, type: z.literal('job.updated'), job: jobSchema }),
  z.object({
    ...eventBase,
    type: z.literal('run.finished'),
    status: runStatusSchema,
    finishedAt: z.iso.datetime(),
  }),
])

export type RunEvent = z.infer<typeof runEventSchema>

export type RunEventType = RunEvent['type']

/** Имя канала Redis pub/sub для конкретного запуска. */
export const runEventChannel = (runId: string): string => `run-events:${runId}`
