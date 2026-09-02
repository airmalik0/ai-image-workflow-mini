import { z } from 'zod'
import { workflowGraphSchema } from './graph/index.js'

export const jobStatuses = ['idle', 'queued', 'running', 'success', 'error', 'skipped'] as const

export type JobStatus = (typeof jobStatuses)[number]

export const jobStatusSchema = z.enum(jobStatuses)

export const runStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const

export type RunStatus = (typeof runStatuses)[number]

export const runStatusSchema = z.enum(runStatuses)

/** Терминальные статусы: job в них больше не меняется без явного retry. */
export const terminalJobStatuses = [
  'success',
  'error',
  'skipped',
] as const satisfies readonly JobStatus[]

export const jobOutputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('image'), fileId: z.string().min(1) }),
])

export type JobOutput = z.infer<typeof jobOutputSchema>

export const jobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
})

export type JobError = z.infer<typeof jobErrorSchema>

export const jobSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  status: jobStatusSchema,
  attempt: z.number().int().nonnegative(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  output: jobOutputSchema.nullable(),
  error: jobErrorSchema.nullable(),
})

export type Job = z.infer<typeof jobSchema>

export const runSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1).nullable(),
  status: runStatusSchema,
  graph: workflowGraphSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})

export type Run = z.infer<typeof runSchema>

/** Полное состояние запуска: то же, что отдаёт polling-фолбэк GET /api/runs/:runId. */
export const runStateSchema = z.object({
  run: runSchema,
  jobs: z.array(jobSchema),
})

export type RunState = z.infer<typeof runStateSchema>
