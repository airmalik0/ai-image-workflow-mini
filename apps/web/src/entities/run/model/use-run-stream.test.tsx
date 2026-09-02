import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Job, RunEvent, RunState } from '@workflow/contracts'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runQueryKey } from '../api/run-api'
import { useRunStream } from './use-run-stream'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  emit(event: RunEvent) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(event), lastEventId: String(event.seq) }),
    )
  }

  close() {
    this.readyState = 2
  }
}

const job = (id: string, status: Job['status']): Job => ({
  id,
  runId: 'run-1',
  nodeId: `node-${id}`,
  status,
  attempt: 0,
  startedAt: null,
  finishedAt: null,
  output: null,
  error: null,
})

const runState: RunState = {
  run: {
    id: 'run-1',
    workflowId: null,
    status: 'queued',
    graph: { nodes: [], edges: [] },
    createdAt: '2026-09-02T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  },
  jobs: [job('a', 'queued'), job('b', 'queued')],
}

describe('useRunStream', () => {
  let client: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    fetchMock = vi.fn(() => Promise.reject(new Error('сеть в этом тесте запрещена')))
    vi.stubGlobal('fetch', fetchMock)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(runQueryKey('run-1'), runState)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    client.clear()
  })

  const source = () => {
    const instance = FakeEventSource.instances.at(-1)
    if (!instance) throw new Error('подписка не открыта')
    return instance
  }

  it('job.updated точечно правит кэш и не ходит за run целиком', () => {
    renderHook(() => useRunStream('run-1'), { wrapper })

    act(() => {
      source().emit({
        type: 'job.updated',
        seq: 1,
        runId: 'run-1',
        job: { ...job('b', 'running'), startedAt: '2026-09-02T10:00:01.000Z' },
      })
    })

    const cached = client.getQueryData<RunState>(runQueryKey('run-1'))
    expect(cached?.jobs.map((item) => item.status)).toEqual(['queued', 'running'])
    // первый job не пересоздавался: точечное обновление не трогает соседей
    expect(cached?.jobs[0]).toBe(runState.jobs[0])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('run.finished переводит статус запуска, не трогая job’ы', () => {
    renderHook(() => useRunStream('run-1'), { wrapper })

    act(() => {
      source().emit({
        type: 'run.finished',
        seq: 2,
        runId: 'run-1',
        status: 'completed',
        finishedAt: '2026-09-02T10:00:09.000Z',
      })
    })

    const cached = client.getQueryData<RunState>(runQueryKey('run-1'))
    expect(cached?.run.status).toBe('completed')
    expect(cached?.jobs).toBe(runState.jobs)
  })

  it('закрывает поток при размонтировании', () => {
    const { unmount } = renderHook(() => useRunStream('run-1'), { wrapper })
    const opened = source()

    unmount()

    expect(opened.readyState).toBe(2)
  })
})
