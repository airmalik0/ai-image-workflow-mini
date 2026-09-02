import type { Job, Preset, Run, Workflow } from '@workflow/contracts'
import type { JobRow, PresetRow, RunRow, WorkflowRow } from './schema.js'

/**
 * Контракты договорились про ISO-8601 в UTC (`z.iso.datetime()`), а драйвер отдаёт `Date`.
 * Конверсия собрана здесь, а не размазана по репозиториям: строка вида
 * `2026-09-02 14:00:00+00`, которую вернул бы drizzle в режиме `mode: 'string'`,
 * не проходит валидацию контракта, и обнаружилось бы это только на границе HTTP.
 */
function iso(value: Date): string {
  return value.toISOString()
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

export function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    name: row.name,
    mainPrompt: row.mainPrompt,
    negativePrompt: row.negativePrompt,
    references: row.referenceFileIds,
    defaults: row.defaults,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    graph: row.graph,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    graph: row.graph,
    createdAt: iso(row.createdAt),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  }
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    runId: row.runId,
    nodeId: row.nodeId,
    status: row.status,
    attempt: row.attempt,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    output: row.output,
    error: row.error,
  }
}

/** Дата из ISO-строки патча. `null` в патче — это осознанное обнуление поля, а не «нет данных». */
export function dateFromIso(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}
