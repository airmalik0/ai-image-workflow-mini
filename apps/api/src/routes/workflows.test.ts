import type { WorkflowGraph } from '@workflow/contracts'
import { validationResultSchema, workflowSchema } from '@workflow/contracts'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/build-test-app.js'

/** Промпт → генерация → результат: минимальный корректный граф. */
function linearGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 'p1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот в скафандре' } },
      {
        id: 'g1',
        kind: 'generateImage',
        position: { x: 200, y: 0 },
        data: { presetId: null, model: null, aspectRatio: '1:1' },
      },
      { id: 'r1', kind: 'result', position: { x: 400, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'p1', sourceHandle: 'text', target: 'g1', targetHandle: 'prompt' },
      { id: 'e2', source: 'g1', sourceHandle: 'image', target: 'r1', targetHandle: 'image' },
    ],
  }
}

describe('CRUD workflow', () => {
  it('сохранённый граф читается, обновляется и удаляется', async () => {
    const app = buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Первый', graph: linearGraph() },
    })
    expect(created.statusCode).toBe(201)
    const workflow = workflowSchema.parse(created.json())

    const list = await app.inject({ method: 'GET', url: '/api/workflows' })
    expect(list.json()).toEqual([workflow])

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: { name: 'Переименован', graph: linearGraph() },
    })
    expect(updated.statusCode).toBe(200)
    expect((updated.json() as { name: string }).name).toBe('Переименован')

    const removed = await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })
    expect(removed.statusCode).toBe(204)

    const gone = await app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}` })
    expect(gone.statusCode).toBe(404)
    expect((gone.json() as { error: { code: string } }).error.code).toBe('WORKFLOW_NOT_FOUND')
    await app.close()
  })

  it('черновик с ошибками сохраняется: редактор не обязан быть валидным на каждом шаге', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: 'Черновик',
        graph: {
          nodes: [{ id: 'p1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: '' } }],
          edges: [],
        },
      },
    })

    expect(response.statusCode).toBe(201)
    await app.close()
  })

  it('PUT несуществующего workflow — 404, а не молчаливое создание', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/нет-такого',
      payload: { name: 'x', graph: linearGraph() },
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /api/workflows/validate', () => {
  it('корректный граф — пустые списки ошибок и предупреждений', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/validate',
      payload: { graph: linearGraph() },
    })

    expect(response.statusCode).toBe(200)
    expect(validationResultSchema.parse(response.json())).toEqual({ errors: [], warnings: [] })
    await app.close()
  })

  it('цикл найден и виновные ноды названы поимённо', async () => {
    const app = buildTestApp()
    const graph = linearGraph()
    graph.nodes.push({
      id: 'e0',
      kind: 'editImage',
      position: { x: 100, y: 200 },
      data: { instruction: '', presetId: null, model: null },
    })
    // g1 → e0 → g1: замкнутая петля через редактирование
    graph.edges.push(
      { id: 'e3', source: 'g1', sourceHandle: 'image', target: 'e0', targetHandle: 'image' },
      { id: 'e4', source: 'e0', sourceHandle: 'image', target: 'g1', targetHandle: 'prompt' },
    )

    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/validate',
      payload: { graph },
    })

    expect(response.statusCode).toBe(200)
    const result = validationResultSchema.parse(response.json())
    const cycle = result.errors.filter((issue) => issue.code === 'CYCLE_DETECTED')
    expect(cycle.length).toBeGreaterThan(0)
    expect(cycle.map((issue) => issue.nodeId)).toContain('g1')
    await app.close()
  })

  it('несовместимые типы портов указывают на виновное ребро', async () => {
    const app = buildTestApp()
    const graph = linearGraph()
    graph.nodes.push({
      id: 'i1',
      kind: 'imageInput',
      position: { x: 0, y: 200 },
      data: { fileId: null },
    })
    // image → prompt: картинка в текстовый вход
    graph.edges.push({
      id: 'e5',
      source: 'i1',
      sourceHandle: 'image',
      target: 'g1',
      targetHandle: 'prompt',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/validate',
      payload: { graph },
    })

    const result = validationResultSchema.parse(response.json())
    const mismatch = result.errors.find((issue) => issue.code === 'PORT_TYPE_MISMATCH')
    expect(mismatch?.edgeId).toBe('e5')
    await app.close()
  })

  it('граф не по схеме — 400 VALIDATION_FAILED, а не пятисотка на разборе', async () => {
    const app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/validate',
      payload: { graph: { nodes: [{ id: 'p1', kind: 'неизвестная' }], edges: [] } },
    })

    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
    await app.close()
  })
})
