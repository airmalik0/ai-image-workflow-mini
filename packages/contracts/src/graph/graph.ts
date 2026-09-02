import { z } from 'zod'
import { NODE_SPECS } from './node-specs.js'

export const positionSchema = z.object({ x: z.number(), y: z.number() })

export type Position = z.infer<typeof positionSchema>

const nodeBase = {
  id: z.string().min(1),
  position: positionSchema,
}

/**
 * Схема отвечает только за структуру: тип ноды известен, параметры разобраны по своему kind.
 * Совместимость портов, циклы и достижимость — семантика, это забота валидатора из @workflow/core.
 */
export const workflowNodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase, kind: z.literal('prompt'), data: NODE_SPECS.prompt.params }),
  z.object({ ...nodeBase, kind: z.literal('imageInput'), data: NODE_SPECS.imageInput.params }),
  z.object({
    ...nodeBase,
    kind: z.literal('generateImage'),
    data: NODE_SPECS.generateImage.params,
  }),
  z.object({ ...nodeBase, kind: z.literal('editImage'), data: NODE_SPECS.editImage.params }),
  z.object({ ...nodeBase, kind: z.literal('result'), data: NODE_SPECS.result.params }),
])

export type WorkflowNode = z.infer<typeof workflowNodeSchema>

export type NodeData = WorkflowNode['data']

export type NodeDataOf<K extends WorkflowNode['kind']> = Extract<WorkflowNode, { kind: K }>['data']

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
})

export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
})

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>
