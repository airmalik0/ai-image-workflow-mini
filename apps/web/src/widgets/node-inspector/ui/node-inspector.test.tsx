import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MAX_PROMPT_LENGTH, NODE_SPECS, nodeKinds } from '@workflow/contracts'
import type { ModelDescriptor, NodeKind, Preset } from '@workflow/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nodeParamFields } from '@/entities/node'
import { useWorkflowStore } from '@/entities/workflow'
import { NodeInspector } from './node-inspector'

const models: ModelDescriptor[] = [
  { id: 'gemini-3.1-flash-image', providerId: 'gemini', label: 'Gemini Flash', supportsEdit: true },
  { id: 'text-only-1', providerId: 'demo', label: 'Только генерация', supportsEdit: false },
]

const preset: Preset = {
  id: 'preset-1',
  name: 'Неон',
  mainPrompt: 'неоновый киберпанк, мокрый асфальт',
  negativePrompt: 'без текста и логотипов',
  references: ['file-1'],
  defaults: null,
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
}

/** Ответы вместо сети: списки моделей и пресетов приходят по контракту. */
const stubApi = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('/models') ? { models } : [preset]
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
}

const store = () => useWorkflowStore.getState()

let client: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const selectOnly = (kind: NodeKind) => {
  const id = store().addNode(kind, { x: 0, y: 0 })
  return id
}

describe('инспектор ноды', () => {
  beforeEach(() => {
    stubApi()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    store().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    client.clear()
  })

  it('без выделения предлагает выбрать ноду', () => {
    render(<NodeInspector />, { wrapper })
    expect(screen.getByText('Нода не выбрана')).toBeTruthy()
  })

  // Имена полей тест не знает: он берёт их из той же таблицы, по которой строится форма.
  it.each(nodeKinds)('строит поля ноды «%s» из NODE_SPECS', (kind) => {
    selectOnly(kind)
    const { container } = render(<NodeInspector />, { wrapper })

    const params = Object.keys(NODE_SPECS[kind].params.parse({}) as Record<string, unknown>)
    for (const name of params) {
      expect(container.querySelector(`[data-param="${name}"]`)).not.toBeNull()
    }
    // и ничего сверх контракта: лишних полей в форме нет
    expect(container.querySelectorAll('[data-param]')).toHaveLength(params.length)
  })

  it('правка текстового параметра уходит в стор через updateNodeData', () => {
    const id = selectOnly('prompt')
    const field = nodeParamFields('prompt').find((item) => item.maxLength !== null)
    expect(field).toBeDefined()

    const { container } = render(<NodeInspector />, { wrapper })
    const control = container.querySelector(`[data-param="${field?.name}"] textarea`)
    expect(control).not.toBeNull()

    fireEvent.change(control as HTMLTextAreaElement, { target: { value: 'кот в скафандре' } })

    const data = store().nodes.find((node) => node.id === id)?.data as Record<string, unknown>
    expect(data[field?.name ?? '']).toBe('кот в скафандре')
  })

  it('промпт показывает счётчик символов с лимитом из контрактов', () => {
    selectOnly('prompt')
    render(<NodeInspector />, { wrapper })

    expect(screen.getByText(`0 / ${MAX_PROMPT_LENGTH}`)).toBeTruthy()
  })

  it('выбор модели чипом не трогает остальные параметры ноды', async () => {
    const id = selectOnly('generateImage')
    store().updateNodeData(id, { aspectRatio: '16:9' })
    render(<NodeInspector />, { wrapper })

    fireEvent.click(await screen.findByRole('button', { name: 'Gemini Flash' }))

    expect(store().nodes[0]?.data).toEqual({
      presetId: null,
      model: 'gemini-3.1-flash-image',
      aspectRatio: '16:9',
    })
  })

  it('модель без поддержки edit выключена в ноде редактирования', async () => {
    selectOnly('editImage')
    render(<NodeInspector />, { wrapper })

    const blocked = await screen.findByRole('button', { name: 'Только генерация' })
    const allowed = screen.getByRole('button', { name: 'Gemini Flash' })

    expect((blocked as HTMLButtonElement).disabled).toBe(true)
    expect((allowed as HTMLButtonElement).disabled).toBe(false)
  })

  it('negative prompt пресета показан выключенным: у модели такого поля нет', async () => {
    const id = selectOnly('generateImage')
    store().updateNodeData(id, { presetId: preset.id, model: models[0]?.id ?? null })
    render(<NodeInspector />, { wrapper })

    const negative = (await screen.findByLabelText(
      'Negative prompt пресета',
    )) as HTMLTextAreaElement

    expect(negative.disabled).toBe(true)
    expect(negative.value).toBe(preset.negativePrompt)
    // пояснение стоит и под полем, и в матрице возможностей модели
    expect(screen.getAllByText(/вклеивается в текст промпта/).length).toBeGreaterThan(0)
  })
})
