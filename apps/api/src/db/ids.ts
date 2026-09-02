import { randomUUID } from 'node:crypto'

/**
 * Идентификаторы с префиксом сущности: в логах, в очереди и в URL сразу видно,
 * что это за строка, а перепутать местами `runId` и `jobId` становится невозможно.
 */
export function newId(prefix: 'preset' | 'workflow' | 'run' | 'job'): string {
  return `${prefix}_${randomUUID()}`
}
