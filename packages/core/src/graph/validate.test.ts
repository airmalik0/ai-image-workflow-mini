import { describe, expect, it } from 'vitest'
import { validateGraph, canConnect } from './validate.js'

const node = (id: string, kind: string, data: unknown = {}) =>
  ({ id, kind, position: { x: 0, y: 0 }, data }) as never

describe('validateGraph', () => {
  it('находит цикл и называет участвующие ноды', () => {
    const graph = {
      nodes: [node('a', 'generateImage'), node('b', 'editImage')],
      edges: [
        { id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' },
        { id: 'e2', source: 'b', sourceHandle: 'image', target: 'a', targetHandle: 'prompt' },
      ],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
  })

  it('запрещает соединение image → text', () => {
    const graph = {
      nodes: [node('a', 'imageInput'), node('b', 'generateImage')],
      edges: [
        { id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'prompt' },
      ],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'PORT_TYPE_MISMATCH' && e.edgeId === 'e1')).toBe(true)
  })

  it('требует подключения обязательного входа', () => {
    const graph = { nodes: [node('a', 'result')], edges: [] }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'REQUIRED_INPUT_MISSING' && e.nodeId === 'a')).toBe(true)
  })

  it('запрещает два источника на одном входном порту', () => {
    const graph = {
      nodes: [node('p1', 'prompt'), node('p2', 'prompt'), node('g', 'generateImage')],
      edges: [
        { id: 'e1', source: 'p1', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
        { id: 'e2', source: 'p2', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
      ],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'INPUT_PORT_OVERSUBSCRIBED')).toBe(true)
  })

  it('разрешает ветвление одного выхода в несколько входов', () => {
    const graph = {
      nodes: [
        node('p', 'prompt'),
        node('a', 'generateImage'),
        node('b', 'generateImage'),
        node('ra', 'result'),
        node('rb', 'result'),
      ],
      edges: [
        { id: 'e1', source: 'p', sourceHandle: 'text', target: 'a', targetHandle: 'prompt' },
        { id: 'e2', source: 'p', sourceHandle: 'text', target: 'b', targetHandle: 'prompt' },
        { id: 'e3', source: 'a', sourceHandle: 'image', target: 'ra', targetHandle: 'image' },
        { id: 'e4', source: 'b', sourceHandle: 'image', target: 'rb', targetHandle: 'image' },
      ],
    }
    expect(validateGraph(graph as never).errors).toEqual([])
  })

  it('предупреждает о ноде, не ведущей к result', () => {
    const graph = {
      nodes: [
        node('p', 'prompt'),
        node('g', 'generateImage'),
        node('r', 'result'),
        node('lost', 'prompt'),
      ],
      edges: [
        { id: 'e1', source: 'p', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
        { id: 'e2', source: 'g', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
      ],
    }
    const { errors, warnings } = validateGraph(graph as never)
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.code === 'NODE_NOT_CONTRIBUTING' && w.nodeId === 'lost')).toBe(
      true,
    )
  })

  it('требует хотя бы одну result-ноду', () => {
    const graph = { nodes: [node('p', 'prompt')], edges: [] }
    expect(validateGraph(graph as never).errors.some((e) => e.code === 'NO_RESULT_NODE')).toBe(true)
  })
})

describe('canConnect', () => {
  it('отклоняет соединение несовместимых типов', () => {
    const graph = { nodes: [node('a', 'imageInput'), node('b', 'generateImage')], edges: [] }
    const res = canConnect(graph as never, {
      source: 'a',
      sourceHandle: 'image',
      target: 'b',
      targetHandle: 'prompt',
    })
    expect(res.ok).toBe(false)
  })

  it('отклоняет соединение, создающее цикл', () => {
    const graph = {
      nodes: [node('a', 'generateImage'), node('b', 'editImage')],
      edges: [{ id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' }],
    }
    const res = canConnect(graph as never, {
      source: 'b',
      sourceHandle: 'image',
      target: 'a',
      targetHandle: 'prompt',
    })
    expect(res.ok).toBe(false)
  })
})
