import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WorkflowGraph } from '@workflow/contracts'
import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveRun } from '@/entities/run'
import { useWorkflowStore } from '@/entities/workflow'
import { useRunWorkflow } from './use-run-workflow'

/** Ветвление из задания: валидный граф, на котором запуск обязан состояться. */
const VALID: WorkflowGraph = {
  nodes: [
    { id: 'prompt-1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кружка' } },
    {
      id: 'generateImage-1',
      kind: 'generateImage',
      position: { x: 300, y: 0 },
      data: { presetId: null, model: null, aspectRatio: '1:1' },
    },
    { id: 'result-1', kind: 'result', position: { x: 600, y: 0 }, data: {} },
  ],
  edges: [
    {
      id: 'e1',
      source: 'prompt-1',
      sourceHandle: 'text',
      target: 'generateImage-1',
      targetHandle: 'prompt',
    },
    {
      id: 'e2',
      source: 'generateImage-1',
      sourceHandle: 'image',
      target: 'result-1',
      targetHandle: 'image',
    },
  ],
}

/** У генерации не подключён обязательный вход `prompt` — граф не запустить. */
const INVALID: WorkflowGraph = {
  nodes: [
    {
      id: 'generateImage-1',
      kind: 'generateImage',
      position: { x: 0, y: 0 },
      data: { presetId: null, model: null, aspectRatio: '1:1' },
    },
    { id: 'result-1', kind: 'result', position: { x: 300, y: 0 }, data: {} },
  ],
  edges: [
    {
      id: 'e1',
      source: 'generateImage-1',
      sourceHandle: 'image',
      target: 'result-1',
      targetHandle: 'image',
    },
  ],
}

let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

describe('запуск графа', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useWorkflowStore.getState().reset()
    useActiveRun.getState().setRunId(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    client.clear()
  })

  it('невалидный граф не уходит на сервер, а называет причину и виновника', async () => {
    fetchMock = vi.fn(() => jsonResponse({ runId: 'run-1', status: 'queued' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    useWorkflowStore.getState().setGraph(INVALID)

    const { result } = renderHook(() => useRunWorkflow(), { wrapper })
    act(() => result.current.start())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.issues.length).toBeGreaterThan(0)
    expect(result.current.issues.some((issue) => issue.nodeId === 'generateImage-1')).toBe(true)
    // виновник выделен на холсте: искать его глазами по сообщению не нужно
    const selected = useWorkflowStore.getState().nodes.filter((node) => node.selected === true)
    expect(selected.map((node) => node.id)).toEqual(['generateImage-1'])
    expect(useActiveRun.getState().runId).toBeNull()
  })

  it('валидный граф уходит на POST /runs, и его runId становится активным', async () => {
    fetchMock = vi.fn(() => jsonResponse({ runId: 'run-42', status: 'queued' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    useWorkflowStore.getState().setGraph(VALID)

    const { result } = renderHook(() => useRunWorkflow(), { wrapper })
    act(() => result.current.start())

    await waitFor(() => expect(useActiveRun.getState().runId).toBe('run-42'))
    expect(result.current.issues).toEqual([])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/runs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ graph: VALID })
  })

  it('отказ сервера GRAPH_INVALID разбирается из details и подсвечивает свою ноду', async () => {
    // сервер валидирует граф заново и вправе не согласиться с клиентом
    fetchMock = vi.fn(() =>
      jsonResponse(
        {
          error: {
            code: 'GRAPH_INVALID',
            message: 'Граф нельзя запустить: он не прошёл проверку',
            details: {
              errors: [
                { code: 'PRESET_NOT_FOUND', message: 'пресет удалён', nodeId: 'generateImage-1' },
              ],
              warnings: [],
            },
          },
        },
        400,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    useWorkflowStore.getState().setGraph(VALID)

    const { result } = renderHook(() => useRunWorkflow(), { wrapper })
    act(() => result.current.start())

    await waitFor(() => expect(result.current.issues).toHaveLength(1))
    expect(result.current.issues[0]?.code).toBe('PRESET_NOT_FOUND')
    const selected = useWorkflowStore.getState().nodes.filter((node) => node.selected === true)
    expect(selected.map((node) => node.id)).toEqual(['generateImage-1'])
    expect(useActiveRun.getState().runId).toBeNull()
  })
})
