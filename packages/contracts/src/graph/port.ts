import { z } from 'zod'

export const portTypes = ['text', 'image'] as const

export type PortType = (typeof portTypes)[number]

export const portTypeSchema = z.enum(portTypes)

/**
 * Описание одного порта ноды. `required` осмысленно только для входов:
 * у выходов оно всегда false и оставлено ради единой формы записи.
 */
export interface PortSpec {
  type: PortType
  required: boolean
}
