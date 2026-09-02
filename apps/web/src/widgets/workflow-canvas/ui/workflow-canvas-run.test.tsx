import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Job, JobStatus, RunEvent, RunState } from '@workflow/contracts'
import { ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveRun } from '@/entities/run'
import { useWorkflowStore } from '@/entities/workflow'
import { findScenario } from '@/features/load-scenario'
import { WorkflowCanvas } from './workflow-canvas'

const RUN_ID = 'run-1'

/** Поток событий подменяется целиком: настоящий `EventSource` в jsdom не живёт. */
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
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }))
  }

  close() {
    this.readyState = 2
  }
}

const job = (nodeId: string, status: JobStatus, patch: Partial<Job> = {}): Job => ({
  id: `job-${nodeId}`,
  runId: RUN_ID,
  nodeId,
  status,
  attempt: 1,
  startedAt: '2026-09-02T10:00:00.000Z',
  finishedAt: null,
  output: null,
  error: null,
  ...patch,
})

const runState = (jobs: Job[]): RunState => ({
  run: {
    id: RUN_ID,
    workflowId: null,
    status: 'running',
    graph: findScenario('branching')?.build() ?? { nodes: [], edges: [] },
    createdAt: '2026-09-02T10:00:00.000Z',
    startedAt: '2026-09-02T10:00:00.000Z',
    finishedAt: null,
  },
  jobs,
})

let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>

/** Ответы вместо сети: справочники пустые, состояние запуска — заданное тестом. */
const stubApi = (state: RunState) => {
  fetchMock = vi.fn((url: string) => {
    const body = url.includes(`/runs/${RUN_ID}`)
      ? state
      : url.includes('/models')
        ? { models: [] }
        : []
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
}

const renderCanvas = () =>
  render(
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        <WorkflowCanvas />
      </ReactFlowProvider>
    </QueryClientProvider>,
  )

/*
 * Роль элемента внутри ноды искать нельзя: React Flow держит карточку
 * `visibility: hidden`, пока не измерит её размеры, а в jsdom мерить нечем —
 * `getByRole` такие элементы не видит. Поэтому поиск идёт по тексту и alt.
 */

/** Карточка ноды на холсте: у неё в шапке напечатан собственный идентификатор. */
const card = (nodeId: string): HTMLElement => {
  const article = screen.getByText(nodeId).closest('article')
  if (article === null) throw new Error(`карточка ноды «${nodeId}» не найдена`)
  return article
}

const source = () => {
  const instance = FakeEventSource.instances.at(-1)
  if (!instance) throw new Error('подписка на события не открыта')
  return instance
}

describe('статусы нод на холсте', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useWorkflowStore.getState().reset()
    useWorkflowStore
      .getState()
      .setGraph(findScenario('branching')?.build() ?? { nodes: [], edges: [] })
    useActiveRun.getState().setRunId(RUN_ID)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useActiveRun.getState().setRunId(null)
    client.clear()
  })

  it('событие job.updated меняет статус конкретной ноды, не трогая соседнюю', async () => {
    stubApi(runState([job('generateImage-1', 'queued'), job('generateImage-2', 'queued')]))
    renderCanvas()

    await waitFor(() =>
      expect(within(card('generateImage-1')).getByText('В очереди')).toBeDefined(),
    )

    act(() => {
      source().emit({
        type: 'job.updated',
        seq: 1,
        runId: RUN_ID,
        job: job('generateImage-1', 'running'),
      })
    })

    expect(within(card('generateImage-1')).getByText('Выполняется')).toBeDefined()
    // соседняя ветка своего статуса не меняла: событие адресное
    expect(within(card('generateImage-2')).getByText('В очереди')).toBeDefined()
  })

  it('успех приносит картинку в ноду результата, а по клику — полный размер', async () => {
    stubApi(
      runState([
        job('result-1', 'success', {
          output: { type: 'image', fileId: 'file-42' },
          finishedAt: '2026-09-02T10:00:05.000Z',
        }),
      ]),
    )
    renderCanvas()

    const preview = await within(card('result-1')).findByAltText('Результат result-1')
    expect(preview.getAttribute('src')).toContain('/files/file-42')

    fireEvent.click(preview)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('img').getAttribute('src')).toContain('/files/file-42')
  })

  it('на упавшей ноде есть Retry с кодом ошибки, а на пропущенной — нет', async () => {
    stubApi(
      runState([
        job('generateImage-1', 'error', {
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'провайдер прилёг', retryable: true },
          finishedAt: '2026-09-02T10:00:03.000Z',
        }),
        job('result-1', 'skipped'),
      ]),
    )
    renderCanvas()

    const failed = card('generateImage-1')
    await waitFor(() => expect(within(failed).getByText('PROVIDER_UNAVAILABLE')).toBeDefined())
    expect(within(failed).getByText('провайдер прилёг')).toBeDefined()

    // пропуск — не сбой: повторять там нечего
    expect(within(card('result-1')).getByText('Пропущено')).toBeDefined()
    expect(within(card('result-1')).queryByText(/Повторить/)).toBeNull()

    fireEvent.click(within(failed).getByText('Повторить'))

    await waitFor(() => {
      const called = fetchMock.mock.calls.map(([url]) => String(url))
      expect(called).toContain(`/api/runs/${RUN_ID}/nodes/generateImage-1/retry`)
    })
  })

  it('неповторяемая ошибка не предлагает повтор вслепую, а объясняет его бесполезность', async () => {
    stubApi(
      runState([
        job('generateImage-1', 'error', {
          error: {
            code: 'PROVIDER_SAFETY_BLOCKED',
            message: 'запрос отклонён по контентной политике',
            retryable: false,
          },
          finishedAt: '2026-09-02T10:00:03.000Z',
        }),
      ]),
    )
    renderCanvas()

    const failed = card('generateImage-1')
    await waitFor(() => expect(within(failed).getByText('PROVIDER_SAFETY_BLOCKED')).toBeDefined())
    expect(within(failed).getByText(/Повтор не поможет/)).toBeDefined()
    expect(within(failed).getByText('Повторить всё равно')).toBeDefined()
  })
})
