import { workflowGraphSchema } from '@workflow/contracts'
import type { Job, Run, WorkflowGraph } from '@workflow/contracts'
import { expect, it } from 'vitest'
import { toJobError } from '../errors.js'
import type { DispatchPayload, JobDispatcher } from '../ports/index.js'
import { FakeProvider } from '../providers/fake-provider.js'
import {
  InMemoryFileStorage,
  InMemoryPresetRepository,
  InMemoryRunRepository,
} from '../testing/index.js'
import { RunEngine } from './engine.js'
import { executeNode } from './executor.js'
import type { ExecutionDeps } from './executor.js'

/**
 * Задержка fake-провайдера и пороги тайминговых тестов вынесены в константы:
 * это единственные числа в файле, которые зависят от скорости машины.
 *
 * 200 мс на генерацию взяты из плана. Порог параллельного прогона — 350 мс:
 * две ветки по 200 мс, выполненные одновременно, укладываются в ~205 мс, так что
 * запас в 145 мс покрывает и запуск таймеров, и кодирование PNG, и загруженный CI.
 * Порог последовательного прогона — ровно 2 × 200 мс: меньше этого времени
 * две генерации подряд закончиться физически не могут, поэтому тест не может
 * «позеленеть» из-за медленной машины — только из-за неработающей задержки.
 */
const LATENCY_MS = 200
const PARALLEL_BUDGET_MS = 350
const SEQUENTIAL_FLOOR_MS = LATENCY_MS * 2

/** Сколько ждать завершения run'а, прежде чем считать движок зависшим. */
const RUN_TIMEOUT_MS = 5_000

// prompt → (A, B) → (RA, RB): обязательное ветвление из ТЗ
const branchingGraph = workflowGraphSchema.parse({
  nodes: [
    { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот в скафандре' } },
    { id: 'a', kind: 'generateImage', position: { x: 200, y: -100 }, data: {} },
    { id: 'b', kind: 'generateImage', position: { x: 200, y: 100 }, data: {} },
    { id: 'ra', kind: 'result', position: { x: 400, y: -100 }, data: {} },
    { id: 'rb', kind: 'result', position: { x: 400, y: 100 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'p', sourceHandle: 'text', target: 'a', targetHandle: 'prompt' },
    { id: 'e2', source: 'p', sourceHandle: 'text', target: 'b', targetHandle: 'prompt' },
    { id: 'e3', source: 'a', sourceHandle: 'image', target: 'ra', targetHandle: 'image' },
    { id: 'e4', source: 'b', sourceHandle: 'image', target: 'rb', targetHandle: 'image' },
  ],
})

/** Один промпт, шесть независимых генераций — граф для проверки семафора. */
const wideGraph = workflowGraphSchema.parse({
  nodes: [
    { id: 'p', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'шесть веток' } },
    ...Array.from({ length: 6 }, (_, i) => [
      { id: `g${i}`, kind: 'generateImage', position: { x: 200, y: i * 80 }, data: {} },
      { id: `r${i}`, kind: 'result', position: { x: 400, y: i * 80 }, data: {} },
    ]).flat(),
  ],
  edges: Array.from({ length: 6 }, (_, i) => [
    { id: `eg${i}`, source: 'p', sourceHandle: 'text', target: `g${i}`, targetHandle: 'prompt' },
    {
      id: `er${i}`,
      source: `g${i}`,
      sourceHandle: 'image',
      target: `r${i}`,
      targetHandle: 'image',
    },
  ]).flat(),
})

interface HarnessOptions {
  latencyMs?: number
  failNodes?: string[]
  maxConcurrency?: number
}

interface RunSnapshot {
  run: Run
  jobs: Record<string, Job>
}

/**
 * Диспетчер, исполняющий job'ы прямо в процессе. Ровно то же место, которое в
 * проде занимает BullMQ: `dispatch` только запускает работу и немедленно
 * возвращает управление, а сигнал отмены живёт здесь, на стороне исполнителя.
 */
class LocalDispatcher implements JobDispatcher {
  readonly executions = new Map<string, number>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #deps: ExecutionDeps
  #engine: RunEngine | null = null
  #busy = 0

  constructor(deps: ExecutionDeps) {
    this.#deps = deps
  }

  bind(engine: RunEngine): void {
    this.#engine = engine
  }

  get busy(): number {
    return this.#busy
  }

  dispatch(payload: DispatchPayload): Promise<void> {
    void this.#execute(payload)
    return Promise.resolve()
  }

  cancel(runId: string): Promise<void> {
    this.#controllers.get(runId)?.abort()
    return Promise.resolve()
  }

  async #execute(payload: DispatchPayload): Promise<void> {
    const { runId, nodeId, jobId } = payload
    this.executions.set(nodeId, (this.executions.get(nodeId) ?? 0) + 1)
    this.#busy += 1
    const controller = this.#controllerFor(runId)
    try {
      const output = await executeNode(
        this.#deps,
        payload.node,
        payload.inputs,
        { runId, jobId, nodeId },
        controller.signal,
      )
      await this.#engine?.onJobFinished(runId, nodeId, { status: 'success', output })
    } catch (error) {
      await this.#engine?.onJobFinished(runId, nodeId, {
        status: 'error',
        error: toJobError(error),
      })
    } finally {
      this.#busy -= 1
    }
  }

  #controllerFor(runId: string): AbortController {
    const existing = this.#controllers.get(runId)
    if (existing) return existing
    const created = new AbortController()
    this.#controllers.set(runId, created)
    return created
  }
}

function createHarness(graph: WorkflowGraph, options: HarnessOptions = {}) {
  const repo = new InMemoryRunRepository()
  const storage = new InMemoryFileStorage()
  const presets = new InMemoryPresetRepository()
  const provider = new FakeProvider({
    latencyMs: options.latencyMs ?? 0,
    failNodes: options.failNodes ?? [],
    // маленькая картинка: тайминговые тесты меряют планирование, а не скорость
    // кодирования PNG. Само кодирование проверяется в png.test.ts
    size: 64,
  })
  const dispatcher = new LocalDispatcher({
    providers: { forModel: () => provider },
    storage,
    presets,
  })

  let runId = ''
  let waiters: Array<() => void> = []
  const engine = new RunEngine({
    dispatcher,
    repo,
    maxConcurrency: options.maxConcurrency ?? 4,
    events: {
      runUpdated: (run) => {
        if (run.status === 'running' || run.status === 'queued') return
        const pending = waiters
        waiters = []
        for (const resolve of pending) resolve()
      },
    },
  })
  dispatcher.bind(engine)

  const nextRunEnd = (): Promise<void> =>
    withTimeout(new Promise<void>((resolve) => waiters.push(resolve)), 'завершения run')

  const snapshot = async (): Promise<RunSnapshot> => {
    const run = await repo.findRun(runId)
    if (!run) throw new Error(`run ${runId} не найден`)
    const jobs = await repo.listJobs(runId)
    return { run, jobs: Object.fromEntries(jobs.map((job) => [job.nodeId, job])) }
  }

  return {
    engine,
    provider,
    dispatcher,
    storage,
    get runId(): string {
      return runId
    },
    executionsOf: (nodeId: string): number => dispatcher.executions.get(nodeId) ?? 0,
    snapshot,
    async start(): Promise<string> {
      const run = await repo.createRun({ workflowId: null, graph })
      runId = run.id
      await engine.start(runId)
      return runId
    },
    async runToEnd(): Promise<RunSnapshot> {
      const finished = nextRunEnd()
      await this.start()
      await finished
      return snapshot()
    },
    async retry(nodeId: string): Promise<RunSnapshot> {
      const finished = nextRunEnd()
      await engine.retryNode(runId, nodeId)
      await finished
      return snapshot()
    },
  }
}

type Harness = ReturnType<typeof createHarness>

async function runToCompletion(
  graph: WorkflowGraph,
  options: HarnessOptions = {},
): Promise<RunSnapshot> {
  return createHarness(graph, options).runToEnd()
}

async function runToFailure(graph: WorkflowGraph, options: HarnessOptions): Promise<Harness> {
  const harness = createHarness(graph, options)
  const state = await harness.runToEnd()
  expect(state.run.status).toBe('failed')
  return harness
}

async function startRun(graph: WorkflowGraph, options: HarnessOptions = {}): Promise<Harness> {
  const harness = createHarness(graph, options)
  await harness.start()
  return harness
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`не дождались ${what}`)), RUN_TIMEOUT_MS),
    ),
  ])
}

/** Ждёт условие, опрашивая состояние: используется, чтобы отменять реально начатый run. */
async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('условие не наступило')
}

function jobOf(state: RunSnapshot, nodeId: string): Job {
  const job = state.jobs[nodeId]
  if (!job) throw new Error(`job для ноды ${nodeId} не найден`)
  return job
}

it('две независимые ветки выполняются одновременно', async () => {
  const harness = createHarness(branchingGraph, { latencyMs: LATENCY_MS, maxConcurrency: 2 })

  const started = Date.now()
  const state = await harness.runToEnd()
  const elapsed = Date.now() - started

  expect(state.run.status).toBe('completed')
  expect(elapsed).toBeLessThan(PARALLEL_BUDGET_MS)
  // то же самое, но без часов: обе генерации действительно были в работе разом
  expect(harness.provider.peakConcurrency).toBe(2)
})

it('при concurrency = 1 те же ветки выполняются последовательно', async () => {
  const harness = createHarness(branchingGraph, { latencyMs: LATENCY_MS, maxConcurrency: 1 })

  const started = Date.now()
  const state = await harness.runToEnd()

  expect(state.run.status).toBe('completed')
  expect(Date.now() - started).toBeGreaterThanOrEqual(SEQUENTIAL_FLOOR_MS)
  expect(harness.provider.peakConcurrency).toBe(1)
})

it('семафор не пускает к провайдеру больше maxConcurrency генераций разом', async () => {
  const harness = createHarness(wideGraph, { latencyMs: 30, maxConcurrency: 2 })
  const state = await harness.runToEnd()

  expect(state.run.status).toBe('completed')
  expect(harness.provider.calls).toBe(6)
  expect(harness.provider.peakConcurrency).toBeLessThanOrEqual(2)
})

it('падение ноды переводит потомков в skipped, а соседнюю ветку не трогает', async () => {
  const state = await runToCompletion(branchingGraph, { failNodes: ['a'] })

  expect(jobOf(state, 'a').status).toBe('error')
  expect(jobOf(state, 'ra').status).toBe('skipped')
  expect(jobOf(state, 'b').status).toBe('success')
  expect(jobOf(state, 'rb').status).toBe('success')
  expect(state.run.status).toBe('failed')
})

it('retry упавшей ноды не пересчитывает успешных предков', async () => {
  const harness = await runToFailure(branchingGraph, { failNodes: ['a'] })
  const promptCallsBefore = harness.provider.callsFor('p')
  const promptRunsBefore = harness.executionsOf('p')

  harness.provider.setFailingNodes([])
  const state = await harness.retry('a')

  expect(harness.provider.callsFor('p')).toBe(promptCallsBefore)
  expect(harness.executionsOf('p')).toBe(promptRunsBefore)
  // соседняя ветка тоже осталась нетронутой: у неё свой успешный результат
  expect(harness.provider.callsFor('b')).toBe(1)
  expect(harness.provider.callsFor('a')).toBe(2)
  expect(jobOf(state, 'a').status).toBe('success')
  expect(jobOf(state, 'ra').status).toBe('success')
  expect(state.run.status).toBe('completed')
})

it('отмена run переводит незапущенные job в skipped и прерывает работающие', async () => {
  const harness = await startRun(branchingGraph, { latencyMs: 5_000, maxConcurrency: 2 })
  await waitFor(async () => jobOf(await harness.snapshot(), 'a').status === 'running')

  await harness.engine.cancel(harness.runId)
  const state = await harness.snapshot()

  expect(state.run.status).toBe('cancelled')
  expect(jobOf(state, 'ra').status).toBe('skipped')
  expect(jobOf(state, 'rb').status).toBe('skipped')

  // работающие генерации получили AbortSignal и завершились, а не «висят» до таймаута
  await waitFor(() => harness.dispatcher.busy === 0)
  expect(harness.provider.aborted).toBeGreaterThan(0)
  // поздние ответы прерванных job'ов не переписывают статус run'а
  expect((await harness.snapshot()).run.status).toBe('cancelled')
})
