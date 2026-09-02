import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowStore } from '@/entities/workflow'
import { WorkflowCanvas } from './workflow-canvas'

const store = () => useWorkflowStore.getState()

let client: QueryClient

/** Ответы вместо сети. `failing` — сервер недоступен, как при поднятом только фронте. */
const stubApi = (failing = false) => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (failing) return Promise.reject(new TypeError('Failed to fetch'))
      const body = url.includes('/models') ? { models: [] } : []
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
}

const renderCanvas = () =>
  render(
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        <WorkflowCanvas />
      </ReactFlowProvider>
    </QueryClientProvider>,
  )

describe('холст', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    store().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('на пустом холсте предлагает готовые сценарии, а не только пустоту', () => {
    stubApi()
    renderCanvas()

    expect(screen.getByText('Холст пуст')).toBeDefined()
    const scenarios = screen.getByRole('group', { name: 'Готовые сценарии' })
    expect(within(scenarios).getAllByRole('button')).toHaveLength(3)
  })

  it('невалидный граф показывает счётчик ошибок, а панель — их причины с кодами', () => {
    stubApi()
    // генерация без подключённого промпта: обязательный вход не заполнен
    store().addNode('generateImage', { x: 0, y: 0 })
    store().addNode('result', { x: 300, y: 0 })
    renderCanvas()

    const toggle = screen.getByRole('button', { name: /ошибок в графе/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    const panel = screen.getByRole('region', { name: 'Проблемы' })
    expect(within(panel).getAllByText('REQUIRED_INPUT_MISSING')).toHaveLength(2)
  })

  it('сетевой сбой справочников виден в строке состояния и объяснён кодом', async () => {
    stubApi(true)
    renderCanvas()

    const toggle = await screen.findByRole('button', { name: /API недоступен/ })
    fireEvent.click(toggle)

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('NETWORK_ERROR')).toBeDefined()
    expect(within(alert).getByText('Failed to fetch')).toBeDefined()
  })
})
