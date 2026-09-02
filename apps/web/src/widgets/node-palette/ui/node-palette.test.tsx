import { NODE_SPECS, nodeKinds } from '@workflow/contracts'
import { ReactFlowProvider } from '@xyflow/react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from '@/entities/workflow'
import { NodePalette } from './node-palette'

const renderPalette = () =>
  render(
    <ReactFlowProvider>
      <NodePalette />
    </ReactFlowProvider>,
  )

describe('палитра нод', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset()
  })

  it('показывает все типы нод из контрактов', () => {
    renderPalette()

    expect(screen.getAllByRole('button')).toHaveLength(nodeKinds.length)
  })

  it('по клику кладёт в стор ноду с параметрами по умолчанию из NODE_SPECS', () => {
    renderPalette()

    screen.getByTitle('Добавить ноду «Генерация»').click()

    const nodes = useWorkflowStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.type).toBe('generateImage')
    expect(nodes[0]?.data).toEqual(NODE_SPECS.generateImage.params.parse({}))
  })
})
