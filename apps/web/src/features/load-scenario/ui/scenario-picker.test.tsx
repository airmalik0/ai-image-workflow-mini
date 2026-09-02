import { validateGraph } from '@workflow/core'
import { ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from '@/entities/workflow'
import { ScenarioPicker } from './scenario-picker'

const renderPicker = (variant: 'cards' | 'compact' = 'cards') =>
  render(
    <ReactFlowProvider>
      <ScenarioPicker variant={variant} />
    </ReactFlowProvider>,
  )

describe('выбор готового сценария', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset()
  })

  it('показывает три сценария из задания', () => {
    renderPicker()

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText('Ветвление')).toBeDefined()
  })

  it('загружает ветвление на холст, и граф проходит валидацию', () => {
    renderPicker()

    fireEvent.click(screen.getByText('Ветвление'))

    const graph = useWorkflowStore.getState().graph()
    expect(validateGraph(graph).errors).toEqual([])
    expect(graph.nodes).toHaveLength(5)
    expect(graph.edges.filter((edge) => edge.source === 'prompt-1')).toHaveLength(2)
  })

  it('второй сценарий заменяет первый, а не дописывается к нему', () => {
    renderPicker('compact')

    fireEvent.click(screen.getByText('Ветвление'))
    fireEvent.click(screen.getByText('Линейная генерация'))

    expect(useWorkflowStore.getState().nodes).toHaveLength(3)
  })
})
