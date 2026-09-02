import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RunState, RunStatus } from '@workflow/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runQueryKey, useActiveRun } from '@/entities/run'
import { useWorkflowStore } from '@/entities/workflow'
import { RunControls } from './run-controls'

const RUN_ID = 'run-1'

const runState = (status: RunStatus): RunState => ({
  run: {
    id: RUN_ID,
    workflowId: null,
    status,
    graph: {
      nodes: [{ id: 'prompt-1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'а' } }],
      edges: [],
    },
    createdAt: '2026-09-02T10:00:00.000Z',
    startedAt: '2026-09-02T10:00:00.000Z',
    finishedAt: null,
  },
  jobs: [
    {
      id: 'job-1',
      runId: RUN_ID,
      nodeId: 'prompt-1',
      status: status === 'completed' ? 'success' : 'running',
      attempt: 1,
      startedAt: '2026-09-02T10:00:00.000Z',
      finishedAt: null,
      output: null,
      error: null,
    },
  ],
})

let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>

const renderControls = () =>
  render(
    <QueryClientProvider client={client}>
      <RunControls />
    </QueryClientProvider>,
  )

/** Состояние запуска кладётся прямо в кэш: сюда же его кладут поток событий и отмена. */
const seed = (status: RunStatus) => {
  useActiveRun.getState().setRunId(RUN_ID)
  client.setQueryData(runQueryKey(RUN_ID), runState(status))
}

describe('пульт запуска', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(runState('cancelled')), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    useWorkflowStore.getState().reset()
    useActiveRun.getState().setRunId(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useActiveRun.getState().setRunId(null)
    client.clear()
  })

  it('без запуска отмены нет, а запустить можно', () => {
    renderControls()

    expect(screen.getByRole('button', { name: 'Запустить' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull()
  })

  it('пока запуск идёт — доступна отмена, а второй запуск заблокирован', async () => {
    seed('running')
    renderControls()

    await waitFor(() => expect(screen.getByText('запуск выполняется')).toBeDefined())
    expect(screen.getByRole('button', { name: 'Запустить' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))

    await waitFor(() => {
      const called = fetchMock.mock.calls.map(([url]) => String(url))
      expect(called).toContain(`/api/runs/${RUN_ID}/cancel`)
    })
    // ответ на отмену — полное состояние запуска, и оно сразу становится показанным
    await waitFor(() => expect(screen.getByText('запуск отменён')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull()
  })

  it('завершённый запуск отменять уже нечего', async () => {
    seed('completed')
    renderControls()

    await waitFor(() => expect(screen.getByText('запуск завершён')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Запустить' }).hasAttribute('disabled')).toBe(false)
  })

  it('пустой граф не уходит на сервер: причина показана списком с кодом', async () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))

    await waitFor(() => expect(screen.getByText('GRAPH_INVALID')).toBeDefined())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
