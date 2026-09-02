import { z } from 'zod'
import type { PortSpec } from './port.js'

export const nodeKinds = ['prompt', 'imageInput', 'generateImage', 'editImage', 'result'] as const

export type NodeKind = (typeof nodeKinds)[number]

export const nodeKindSchema = z.enum(nodeKinds)

export interface NodeSpec {
  inputs: Record<string, PortSpec>
  outputs: Record<string, PortSpec>
  params: z.ZodType
}

export const MAX_PROMPT_LENGTH = 3000

/**
 * Единственное место, где описана топология портов и параметры нод.
 * Из этой таблицы выводятся правила соединения на канвасе, серверная валидация,
 * форма инспектора и резолв входов в воркере — добавление нового типа ноды
 * начинается со строки здесь.
 */
export const NODE_SPECS = {
  prompt: {
    inputs: {},
    outputs: { text: { type: 'text', required: false } },
    params: z.object({ text: z.string().max(MAX_PROMPT_LENGTH).default('') }),
  },
  imageInput: {
    inputs: {},
    outputs: { image: { type: 'image', required: false } },
    params: z.object({ fileId: z.string().nullable().default(null) }),
  },
  generateImage: {
    inputs: { prompt: { type: 'text', required: true } },
    outputs: { image: { type: 'image', required: false } },
    params: z.object({
      presetId: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
      aspectRatio: z.string().default('1:1'),
    }),
  },
  editImage: {
    inputs: {
      image: { type: 'image', required: true },
      instruction: { type: 'text', required: false },
    },
    outputs: { image: { type: 'image', required: false } },
    params: z.object({
      instruction: z.string().max(MAX_PROMPT_LENGTH).default(''),
      presetId: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
    }),
  },
  result: {
    inputs: { image: { type: 'image', required: true } },
    outputs: {},
    params: z.object({}),
  },
} as const satisfies Record<NodeKind, NodeSpec>
