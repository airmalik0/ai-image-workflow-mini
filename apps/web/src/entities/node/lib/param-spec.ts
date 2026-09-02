import { NODE_SPECS } from '@workflow/contracts'
import type { NodeKind } from '@workflow/contracts'
import * as z from 'zod'

/**
 * Описание одного параметра ноды, выведенное из схемы контракта.
 * Второго списка полей на фронте нет: добавили параметр в `NODE_SPECS` —
 * он сам появился в инспекторе.
 */
export interface ParamFieldSpec {
  name: string
  /** Значение может быть `null` — «не выбрано». */
  nullable: boolean
  /** Ограничение длины из схемы; по нему же рисуется счётчик символов. */
  maxLength: number | null
  defaultValue: string | null
}

/** Кусок JSON Schema, который нам нужен от zod: остальное для формы не важно. */
interface JsonProperty {
  type?: string | string[]
  maxLength?: number
  default?: unknown
}

interface JsonObjectSchema {
  properties?: Record<string, JsonProperty>
}

const typesOf = (property: JsonProperty): string[] => {
  if (Array.isArray(property.type)) return property.type
  return property.type === undefined ? [] : [property.type]
}

/**
 * Поля формы для типа ноды. Схема параметров разбирается через `z.toJSONSchema` —
 * это публичный интерфейс zod, а не подглядывание во внутренности: форма не должна
 * ломаться от того, что схему обернули в `.default()` или `.nullable()`.
 */
export const nodeParamFields = (kind: NodeKind): ParamFieldSpec[] => {
  const schema = z.toJSONSchema(NODE_SPECS[kind].params, { io: 'input' }) as JsonObjectSchema

  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    nullable: typesOf(property).includes('null'),
    maxLength: typeof property.maxLength === 'number' ? property.maxLength : null,
    defaultValue: typeof property.default === 'string' ? property.default : null,
  }))
}

/** Текущее значение параметра в виде строки: `null` — «не выбрано». */
export const paramValue = (data: Record<string, unknown>, name: string): string | null => {
  const value = data[name]
  if (typeof value === 'string') return value
  return null
}
