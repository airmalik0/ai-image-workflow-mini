import { z } from 'zod'
import { MAX_PROMPT_LENGTH, workflowGraphSchema } from './graph/index.js'
import { presetDefaultsSchema } from './preset.js'
import { runStatusSchema } from './run.js'

// --- Валидация графа -------------------------------------------------------

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  details: z.unknown().optional(),
})

export type ValidationIssue = z.infer<typeof validationIssueSchema>

export const validationResultSchema = z.object({
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
})

export type ValidationResult = z.infer<typeof validationResultSchema>

export const validateGraphRequestSchema = z.object({ graph: workflowGraphSchema })

export const validateGraphResponseSchema = validationResultSchema

// --- Сохранённые workflow --------------------------------------------------

export const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  graph: workflowGraphSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Workflow = z.infer<typeof workflowSchema>

export const saveWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(200),
  graph: workflowGraphSchema,
})

export type SaveWorkflowRequest = z.infer<typeof saveWorkflowRequestSchema>

// --- Пресеты ---------------------------------------------------------------

export const createPresetRequestSchema = z.object({
  name: z.string().min(1).max(200),
  mainPrompt: z.string().max(MAX_PROMPT_LENGTH),
  negativePrompt: z.string().max(MAX_PROMPT_LENGTH).nullable().default(null),
  references: z.array(z.string().min(1)).default([]),
  defaults: presetDefaultsSchema.nullable().default(null),
})

export type CreatePresetRequest = z.infer<typeof createPresetRequestSchema>

export const updatePresetRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mainPrompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  negativePrompt: z.string().max(MAX_PROMPT_LENGTH).nullable().optional(),
  references: z.array(z.string().min(1)).optional(),
  defaults: presetDefaultsSchema.nullable().optional(),
})

export type UpdatePresetRequest = z.infer<typeof updatePresetRequestSchema>

// --- Запуски ---------------------------------------------------------------

/** Запустить можно либо переданный граф, либо ранее сохранённый workflow — но не оба сразу. */
export const createRunRequestSchema = z.union([
  z.object({ graph: workflowGraphSchema }),
  z.object({ workflowId: z.string().min(1) }),
])

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>

export const createRunResponseSchema = z.object({
  runId: z.string().min(1),
  status: runStatusSchema,
})

export type CreateRunResponse = z.infer<typeof createRunResponseSchema>

// --- Файлы -----------------------------------------------------------------

export const fileUploadResponseSchema = z.object({
  fileId: z.string().min(1),
  url: z.string().min(1),
})

export type FileUploadResponse = z.infer<typeof fileUploadResponseSchema>

// --- Модели и здоровье -----------------------------------------------------

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  label: z.string().min(1),
  supportsEdit: z.boolean(),
})

export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>

export const modelsResponseSchema = z.object({ models: z.array(modelDescriptorSchema) })

/**
 * Предохранитель публичного демо-стенда: он ходит в платный API по ключу
 * владельца. Считаются успешные обращения к боевому провайдеру за сутки;
 * по исчерпании стенд переключается на офлайн-провайдера — и обязан об этом
 * сказать, поэтому признак живёт в health, а не только в логах.
 */
export const demoQuotaStatusSchema = z.object({
  limit: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  exhausted: z.boolean(),
})

export type DemoQuotaStatus = z.infer<typeof demoQuotaStatusSchema>

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  redis: z.enum(['up', 'down']),
  provider: z.string().min(1),
  /** Отсутствует, когда предохранитель выключен (`DEMO_DAILY_LIMIT=0`). */
  demo: demoQuotaStatusSchema.optional(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
