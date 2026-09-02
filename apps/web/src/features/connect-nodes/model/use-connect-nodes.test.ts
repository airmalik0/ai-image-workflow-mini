import { canConnect } from '@workflow/core'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from '@/entities/workflow'
import { useConnectNodes } from './use-connect-nodes'

const store = () => useWorkflowStore.getState()

const graph = () => store().graph()

describe('соединение нод на канвасе', () => {
  beforeEach(() => {
    store().reset()
  })

  it('блокирует несовместимую пару портов и объясняет отказ словами ядра', () => {
    const image = store().addNode('imageInput', { x: 0, y: 0 })
    const generate = store().addNode('generateImage', { x: 300, y: 0 })
    const candidate = {
      source: image,
      sourceHandle: 'image',
      target: generate,
      targetHandle: 'prompt',
    }

    const { result } = renderHook(() => useConnectNodes())
    expect(result.current.isValidConnection(candidate)).toBe(false)

    act(() => result.current.onConnect(candidate))

    expect(store().edges).toHaveLength(0)
    // ровно та строка, которую вернуло ядро: канвас не сочиняет своих формулировок
    const check = canConnect(graph(), candidate)
    expect(check).toEqual({ ok: false, reason: 'Порт типа «image» нельзя соединить с «text»' })
    expect(result.current.rejection?.message).toBe(check.ok ? '' : check.reason)
  })

  it('разрешает ветвление: один выход уходит в два входа', () => {
    const prompt = store().addNode('prompt', { x: 0, y: 0 })
    const first = store().addNode('generateImage', { x: 300, y: -100 })
    const second = store().addNode('generateImage', { x: 300, y: 100 })

    const { result } = renderHook(() => useConnectNodes())
    const toFirst = {
      source: prompt,
      sourceHandle: 'text',
      target: first,
      targetHandle: 'prompt',
    }
    const toSecond = {
      source: prompt,
      sourceHandle: 'text',
      target: second,
      targetHandle: 'prompt',
    }

    expect(result.current.isValidConnection(toFirst)).toBe(true)
    act(() => result.current.onConnect(toFirst))
    expect(result.current.isValidConnection(toSecond)).toBe(true)
    act(() => result.current.onConnect(toSecond))

    expect(store().edges).toHaveLength(2)
    expect(result.current.rejection).toBeNull()
  })

  it('отклоняет второй источник на уже занятом входе', () => {
    const first = store().addNode('prompt', { x: 0, y: -100 })
    const second = store().addNode('prompt', { x: 0, y: 100 })
    const generate = store().addNode('generateImage', { x: 300, y: 0 })

    const { result } = renderHook(() => useConnectNodes())
    act(() =>
      result.current.onConnect({
        source: first,
        sourceHandle: 'text',
        target: generate,
        targetHandle: 'prompt',
      }),
    )

    const rival = {
      source: second,
      sourceHandle: 'text',
      target: generate,
      targetHandle: 'prompt',
    }
    expect(result.current.isValidConnection(rival)).toBe(false)

    act(() => result.current.onConnect(rival))

    expect(store().edges).toHaveLength(1)
    expect(result.current.rejection?.message).toBe('Вход «prompt» уже занят другим соединением')
  })

  it('не даёт замкнуть граф в цикл', () => {
    const generate = store().addNode('generateImage', { x: 0, y: 0 })
    const edit = store().addNode('editImage', { x: 300, y: 0 })

    const { result } = renderHook(() => useConnectNodes())
    act(() =>
      result.current.onConnect({
        source: generate,
        sourceHandle: 'image',
        target: edit,
        targetHandle: 'image',
      }),
    )

    const loop = {
      source: edit,
      sourceHandle: 'image',
      target: generate,
      targetHandle: 'prompt',
    }
    expect(result.current.isValidConnection(loop)).toBe(false)

    act(() => result.current.onConnect(loop))

    expect(store().edges).toHaveLength(1)
    expect(result.current.rejection?.message).toBe('Соединение замкнёт граф в цикл')
  })
})
