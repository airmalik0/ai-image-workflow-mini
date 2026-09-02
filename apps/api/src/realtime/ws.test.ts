import { runEventSchema, workflowGraphSchema } from '@workflow/contracts'
import type { RunEvent, WorkflowGraph } from '@workflow/contracts'
import { InMemoryRunRepository } from '@workflow/core/testing'
import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import { buildTestApp } from '../testing/build-test-app.js'
import { InMemoryRunEventBus } from '../testing/in-memory-event-bus.js'

const graph: WorkflowGraph = workflowGraphSchema.parse({
  nodes: [
    { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот' } },
    { id: 'g', kind: 'generateImage', position: { x: 200, y: 0 }, data: {} },
    { id: 'r', kind: 'result', position: { x: 400, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'p', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
    { id: 'e2', source: 'g', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
  ],
})

const started = (runId: string): Parameters<InMemoryRunEventBus['publish']>[0] => ({
  type: 'run.started',
  runId,
  startedAt: new Date().toISOString(),
})

const finished = (runId: string): Parameters<InMemoryRunEventBus['publish']>[0] => ({
  type: 'run.finished',
  runId,
  status: 'completed',
  finishedAt: new Date().toISOString(),
})

interface Collected {
  events: RunEvent[]
  raw: string[]
  onInit: (socket: WebSocket) => void
}

/**
 * Слушатели вешаются в `onInit`, до открытия сокета. Повесить их после
 * `injectWS` — значит проспать историю: сервер отдаёт её сразу, а `EventEmitter`
 * ничего не буферизует.
 */
function collector(): Collected {
  const events: RunEvent[] = []
  const raw: string[] = []
  return {
    events,
    raw,
    onInit: (socket) => {
      socket.on('message', (data: Buffer) => {
        const text = data.toString()
        raw.push(text)
        const parsed = runEventSchema.safeParse(JSON.parse(text))
        if (parsed.success) events.push(parsed.data)
      })
    },
  }
}

async function waitFor(done: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('не дождались сообщений')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('WS /api/ws', () => {
  it('отдаёт историю и живые события тем же контрактом, что и SSE', async () => {
    const events = new InMemoryRunEventBus()
    const runs = new InMemoryRunRepository()
    const app = buildTestApp({ runs, events })
    const run = await runs.createRun({ workflowId: null, graph })

    await events.publish(started(run.id))

    // injectWS появляется после регистрации плагина, то есть после ready
    await app.ready()
    const received = collector()
    const socket = await app.injectWS(`/api/ws?runId=${run.id}`, undefined, {
      onInit: received.onInit,
    })
    await waitFor(() => received.events.length === 1)

    await events.publish(finished(run.id))
    await waitFor(() => received.events.length === 2)

    expect(received.events.map((event) => event.type)).toEqual(['run.started', 'run.finished'])
    expect(received.events.map((event) => event.seq)).toEqual([1, 2])

    socket.close()
    await app.close()
  })

  it('докачивает с позиции lastEventId', async () => {
    const events = new InMemoryRunEventBus()
    const runs = new InMemoryRunRepository()
    const app = buildTestApp({ runs, events })
    const run = await runs.createRun({ workflowId: null, graph })

    const first = await events.publish(started(run.id))
    const second = await events.publish(finished(run.id))

    // injectWS появляется после регистрации плагина, то есть после ready
    await app.ready()
    const received = collector()
    const socket = await app.injectWS(
      `/api/ws?runId=${run.id}&lastEventId=${first.seq}`,
      undefined,
      { onInit: received.onInit },
    )
    await waitFor(() => received.events.length === 1)

    expect(received.events.map((event) => event.seq)).toEqual([second.seq])

    socket.close()
    await app.close()
  })

  it('неизвестный запуск закрывается с конвертом ошибки, а не молча', async () => {
    const app = buildTestApp()
    // injectWS появляется после регистрации плагина, то есть после ready
    await app.ready()
    const received = collector()
    const socket = await app.injectWS('/api/ws?runId=нет-такого', undefined, {
      onInit: received.onInit,
    })
    await waitFor(() => received.raw.length === 1)

    expect(JSON.parse(received.raw[0] ?? '{}')).toMatchObject({
      error: { code: 'RUN_NOT_FOUND' },
    })

    socket.close()
    await app.close()
  })
})
