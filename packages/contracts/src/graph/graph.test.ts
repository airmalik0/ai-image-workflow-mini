import { describe, expect, it } from 'vitest'
import { workflowGraphSchema, NODE_SPECS } from './index.js'

describe('workflowGraphSchema', () => {
  it('принимает минимальный валидный граф', () => {
    const graph = {
      nodes: [
        { id: 'n1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот' } },
        { id: 'n2', kind: 'result', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', sourceHandle: 'text', target: 'n2', targetHandle: 'image' },
      ],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('отвергает неизвестный тип ноды', () => {
    const graph = {
      nodes: [{ id: 'n1', kind: 'wat', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
  })
})

describe('NODE_SPECS', () => {
  it('описывает все пять типов нод', () => {
    expect(Object.keys(NODE_SPECS).sort()).toEqual([
      'editImage',
      'generateImage',
      'imageInput',
      'prompt',
      'result',
    ])
  })

  it('generateImage принимает text на входе и отдаёт image', () => {
    expect(NODE_SPECS.generateImage.inputs.prompt).toEqual({ type: 'text', required: true })
    expect(NODE_SPECS.generateImage.outputs.image).toEqual({ type: 'image', required: false })
  })

  it('editImage требует image и допускает необязательный text', () => {
    expect(NODE_SPECS.editImage.inputs.image.required).toBe(true)
    expect(NODE_SPECS.editImage.inputs.instruction.required).toBe(false)
  })
})
