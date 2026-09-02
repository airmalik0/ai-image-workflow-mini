import { workflowGraphSchema } from '@workflow/contracts'
import { validateGraph } from '@workflow/core'
import { describe, expect, it } from 'vitest'
import { SCENARIOS, findScenario } from './scenarios'

describe('готовые сценарии', () => {
  it('их ровно три — те, что нарисованы в задании', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(['linear', 'edit', 'branching'])
  })

  it.each(SCENARIOS)('сценарий «$name» проходит схему графа', (scenario) => {
    expect(workflowGraphSchema.safeParse(scenario.build()).success).toBe(true)
  })

  it.each(SCENARIOS)('сценарий «$name» проходит validateGraph без ошибок', (scenario) => {
    const result = validateGraph(scenario.build())

    expect(result.errors).toEqual([])
    // предупреждений тоже быть не должно: в сценарии нет нод, не ведущих к result
    expect(result.warnings).toEqual([])
  })

  it('линейный сценарий — это цепочка prompt → generateImage → result', () => {
    const graph = findScenario('linear')?.build()

    expect(graph?.nodes.map((node) => node.kind)).toEqual(['prompt', 'generateImage', 'result'])
    expect(graph?.edges).toHaveLength(2)
  })

  it('сценарий редактирования начинается с imageInput и правит его через editImage', () => {
    const graph = findScenario('edit')?.build()

    expect(graph?.nodes.map((node) => node.kind)).toEqual(['imageInput', 'editImage', 'result'])
    // необязательный вход instruction не подключён — текст лежит в параметрах ноды
    expect(graph?.edges.every((edge) => edge.targetHandle !== 'instruction')).toBe(true)
  })

  it('ветвящийся сценарий действительно ветвится: у промпта два потребителя', () => {
    const graph = findScenario('branching')?.build()
    if (graph === undefined) throw new Error('сценарий ветвления обязан существовать')

    const prompt = graph.nodes.find((node) => node.kind === 'prompt')
    const consumers = graph.edges.filter((edge) => edge.source === prompt?.id)

    expect(consumers).toHaveLength(2)
    expect(new Set(consumers.map((edge) => edge.target)).size).toBe(2)
    expect(graph.nodes.filter((node) => node.kind === 'generateImage')).toHaveLength(2)
    expect(graph.nodes.filter((node) => node.kind === 'result')).toHaveLength(2)
  })

  it('идентификаторы нод и рёбер уникальны — граф можно положить в стор как есть', () => {
    for (const scenario of SCENARIOS) {
      const graph = scenario.build()
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length)
      expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length)
    }
  })

  it('каждый вызов даёт свежий граф — редактирование одного не портит сценарий', () => {
    const first = findScenario('linear')?.build()
    const second = findScenario('linear')?.build()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})
