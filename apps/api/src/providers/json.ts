/**
 * Чтение чужого JSON без `any`. Тела ответов провайдеров не типизированы и
 * меняются молча, поэтому доступ к ним идёт через проверки, а не через приведение
 * типа: `body.error.details[1].retryDelay` на неожиданной форме ответа должен
 * давать null, а не `TypeError` внутри обработчика ошибок.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function readValue(source: unknown, ...path: readonly string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    const record = asRecord(current)
    if (!record) return undefined
    current = record[key]
  }
  return current
}

export function readString(source: unknown, ...path: readonly string[]): string | null {
  const value = readValue(source, ...path)
  return typeof value === 'string' ? value : null
}

export function readArray(source: unknown, ...path: readonly string[]): readonly unknown[] {
  const value = readValue(source, ...path)
  return Array.isArray(value) ? value : []
}
