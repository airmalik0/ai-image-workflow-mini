import type { JobError, JobOutput, PresetDefaults, WorkflowGraph } from '@workflow/contracts'
import { jobStatuses, runStatuses } from '@workflow/contracts'
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Перечисления заводятся из тех же массивов, что и zod-схемы контрактов:
 * список статусов существует в одном месте, а база проверяет его на своей стороне.
 * Строковая колонка с `$type<JobStatus>()` дала бы типизацию без единой гарантии —
 * любой `UPDATE` мимо приложения записал бы в неё что угодно.
 */
export const jobStatusEnum = pgEnum('job_status', jobStatuses)
export const runStatusEnum = pgEnum('run_status', runStatuses)

/** Откуда взялся файл. Нужно, чтобы отличать сид от пользовательских загрузок при чистке. */
export const fileSources = ['seed', 'upload', 'generated'] as const

export type FileSource = (typeof fileSources)[number]

export const fileSourceEnum = pgEnum('file_source', fileSources)

/** Метаданные файлов. Байты живут в FileStorage (каталог или S3), здесь — только учёт. */
export const files = pgTable('files', {
  id: text('id').primaryKey(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  source: fileSourceEnum('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

/**
 * Пресет — отдельная сущность, как прямо требует ТЗ.
 * Колонка референсов названа `reference_file_ids`, а не `references`: последнее —
 * зарезервированное слово SQL, и любой ручной запрос по базе пришлось бы писать в кавычках.
 */
export const presets = pgTable('presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mainPrompt: text('main_prompt').notNull(),
  negativePrompt: text('negative_prompt'),
  referenceFileIds: jsonb('reference_file_ids').$type<string[]>().notNull().default([]),
  defaults: jsonb('defaults').$type<PresetDefaults>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const workflows = pgTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('workflows_updated_at_idx').on(table.updatedAt.desc())],
)

/**
 * Запуск хранит СНИМОК графа, а не ссылку на него: workflow можно отредактировать
 * или удалить, а история запуска обязана остаться воспроизводимой. Поэтому
 * `workflow_id` — необязательная ссылка с `ON DELETE SET NULL`, а не источник данных.
 */
export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(),
    seq: serial('seq').notNull(),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    status: runStatusEnum('status').notNull().default('queued'),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  // список запусков всегда идёт «последние сверху»; порядок берётся из `seq`,
  // а не из `created_at`: два запуска в одну миллисекунду упорядочились бы случайно
  (table) => [index('runs_seq_idx').on(table.seq.desc())],
)

/**
 * Job — одна нода одного запуска.
 *
 * `jobs_run_node_uq` — не украшение схемы, а рабочий механизм: `ensureJobs` вставляет
 * job'ы на все ноды графа через `ON CONFLICT (run_id, node_id) DO NOTHING`, и повторный
 * вызов (перезапуск API, ретрай постановки) не плодит дублей и не сбрасывает прогресс.
 *
 * `seq` задаёт порядок выдачи в `listJobs`. Порядок значим: движок обходит список
 * job'ов и отдаёт исполнителю первые готовые, пока не кончатся слоты конкурентности, —
 * без стабильного порядка выбор нод при переполнении слотов был бы случайным.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    seq: serial('seq').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    status: jobStatusEnum('status').notNull().default('idle'),
    attempt: integer('attempt').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    output: jsonb('output').$type<JobOutput>(),
    error: jsonb('error').$type<JobError>(),
  },
  (table) => [
    uniqueIndex('jobs_run_node_uq').on(table.runId, table.nodeId),
    index('jobs_run_seq_idx').on(table.runId, table.seq),
  ],
)

export const schema = { files, presets, workflows, runs, jobs }

export type PresetRow = typeof presets.$inferSelect
export type WorkflowRow = typeof workflows.$inferSelect
export type RunRow = typeof runs.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type FileRow = typeof files.$inferSelect
