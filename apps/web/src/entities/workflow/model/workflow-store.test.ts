import { MAX_PROMPT_LENGTH, NODE_SPECS } from '@workflow/contracts'
import type { WorkflowGraph } from '@workflow/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from './workflow-store'

const at = (x: number, y: number) => ({ x, y })

const store = () => useWorkflowStore.getState()

describe('workflow store', () => {
  beforeEach(() => {
    store().reset()
  })

  it('кладёт ноду с параметрами по умолчанию из NODE_SPECS', () => {
    const id = store().addNode('generateImage', at(0, 0))

    const node = store().nodes.find((item) => item.id === id)
    expect(node?.type).toBe('generateImage')
    expect(node?.data).toEqual(NODE_SPECS.generateImage.params.parse({}))
    expect(node?.data).toEqual({ presetId: null, model: null, aspectRatio: '1:1' })
  })

  it('новая нода становится единственной выделенной', () => {
    store().addNode('prompt', at(0, 0))
    const second = store().addNode('prompt', at(100, 0))

    expect(store().nodes.map((node) => node.selected)).toEqual([false, true])
    expect(store().nodes[1]?.id).toBe(second)
  })

  it('пишет правку параметра в data ноды, не трогая остальные поля', () => {
    const id = store().addNode('generateImage', at(0, 0))

    store().updateNodeData(id, { model: 'gpt-image-2' })

    const node = store().nodes.find((item) => item.id === id)
    expect(node?.data).toEqual({ presetId: null, model: 'gpt-image-2', aspectRatio: '1:1' })
  })

  it('не принимает правку, которую не примет схема ноды', () => {
    const id = store().addNode('prompt', at(0, 0))
    const before = store().nodes[0]?.data

    store().updateNodeData(id, { text: 'x'.repeat(MAX_PROMPT_LENGTH + 1) })

    expect(store().nodes[0]?.data).toBe(before)
  })

  it('соединяет совместимые порты', () => {
    const prompt = store().addNode('prompt', at(0, 0))
    const generate = store().addNode('generateImage', at(300, 0))

    const check = store().connect({
      source: prompt,
      sourceHandle: 'text',
      target: generate,
      targetHandle: 'prompt',
    })

    expect(check).toEqual({ ok: true })
    expect(store().edges).toHaveLength(1)
  })

  it('удаляет выделенное вместе с висящими на нём связями', () => {
    const prompt = store().addNode('prompt', at(0, 0))
    const generate = store().addNode('generateImage', at(300, 0))
    store().connect({
      source: prompt,
      sourceHandle: 'text',
      target: generate,
      targetHandle: 'prompt',
    })

    // выделена вторая нода — она добавлена последней
    store().removeSelection()

    expect(store().nodes.map((node) => node.id)).toEqual([prompt])
    expect(store().edges).toHaveLength(0)
  })

  it('кладёт готовый граф целиком и забывает прежний', () => {
    store().addNode('editImage', at(0, 0))

    const graph: WorkflowGraph = {
      nodes: [
        { id: 'prompt-1', kind: 'prompt', position: at(0, 0), data: { text: 'кот' } },
        { id: 'result-1', kind: 'result', position: at(320, 0), data: {} },
      ],
      edges: [
        {
          id: 'prompt-1.text--result-1.image',
          source: 'prompt-1',
          sourceHandle: 'text',
          target: 'result-1',
          targetHandle: 'image',
        },
      ],
    }

    store().setGraph(graph)

    expect(store().nodes.map((node) => node.id)).toEqual(['prompt-1', 'result-1'])
    expect(store().nodes.map((node) => node.type)).toEqual(['prompt', 'result'])
    expect(store().edges).toHaveLength(1)
    // граф положен как есть — проекция обратно в домен совпадает с исходником
    expect(store().graph()).toEqual(graph)
  })

  it('после загрузки графа ничего не выделено — инспектор не показывает случайную ноду', () => {
    store().setGraph({
      nodes: [{ id: 'result-1', kind: 'result', position: at(0, 0), data: {} }],
      edges: [],
    })

    expect(store().nodes.some((node) => node.selected === true)).toBe(false)
  })

  it('вставляет копию выделения с новыми идентификаторами и связями', () => {
    const prompt = store().addNode('prompt', at(0, 0))
    const generate = store().addNode('generateImage', at(300, 0))
    store().connect({
      source: prompt,
      sourceHandle: 'text',
      target: generate,
      targetHandle: 'prompt',
    })

    store().selectAll()
    store().copySelection()
    store().paste()

    expect(store().nodes).toHaveLength(4)
    expect(store().edges).toHaveLength(2)
    expect(new Set(store().nodes.map((node) => node.id)).size).toBe(4)
    expect(store().nodes.filter((node) => node.selected === true)).toHaveLength(2)

    const copiedPrompt = store().nodes.find((node) => node.id === 'prompt-2')
    expect(copiedPrompt?.position).toEqual({ x: 32, y: 32 })
    expect(store().edges.some((edge) => edge.source === 'prompt-2')).toBe(true)
    expect(store().edges.some((edge) => edge.target === `${generate}`)).toBe(true)
  })
})
