import type { Job, RunState, WorkflowGraph } from '@workflow/contracts'
import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline-layout'

const T0 = Date.parse('2026-09-02T10:00:00.000Z')

const at = (ms: number): string => new Date(T0 + ms).toISOString()

const graph: WorkflowGraph = {
  nodes: [
    { id: 'prompt-1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот' } },
    {
      id: 'generateImage-1',
      kind: 'generateImage',
      position: { x: 0, y: 0 },
      data: { presetId: null, model: null, aspectRatio: '1:1' },
    },
    {
      id: 'generateImage-2',
      kind: 'generateImage',
      position: { x: 0, y: 0 },
      data: { presetId: null, model: null, aspectRatio: '16:9' },
    },
    { id: 'result-1', kind: 'result', position: { x: 0, y: 0 }, data: {} },
    { id: 'result-2', kind: 'result', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [],
}

const job = (
  nodeId: string,
  from: number | null,
  to: number | null,
  rest: Partial<Job> = {},
): Job => ({
  id: `job-${nodeId}`,
  runId: 'run-1',
  nodeId,
  status: 'success',
  attempt: 1,
  startedAt: from === null ? null : at(from),
  finishedAt: to === null ? null : at(to),
  output: null,
  error: null,
  ...rest,
})

/** Ветвление из ТЗ: две генерации от одного промпта идут внахлёст. */
const branchingRun = (jobs: Job[]): RunState => ({
  run: {
    id: 'run-1',
    workflowId: null,
    status: 'completed',
    graph,
    createdAt: at(0),
    startedAt: at(0),
    finishedAt: at(282),
  },
  jobs,
})

const overlappingJobs = [
  job('prompt-1', 0, 12),
  job('generateImage-1', 20, 230),
  job('generateImage-2', 22, 268),
  job('result-1', 240, 246),
  job('result-2', 276, 282),
]

describe('buildTimeline', () => {
  it('раскладывает job’ы по оси в миллисекундах от старта run’а', () => {
    const model = buildTimeline(branchingRun(overlappingJobs))

    expect(model.spanMs).toBe(282)
    expect(model.rows).toHaveLength(5)

    const generate = model.rows.find((row) => row.nodeId === 'generateImage-1')
    expect(generate?.kind).toBe('generateImage')
    expect(generate?.bar).toEqual(
      expect.objectContaining({ startMs: 20, endMs: 230, durationMs: 210, open: false }),
    )
    expect(generate?.bar?.offset).toBeCloseTo(20 / 282, 6)
    expect(generate?.bar?.width).toBeCloseTo(210 / 282, 6)
  })

  it('полосы двух независимых генераций перекрываются по разметке', () => {
    const model = buildTimeline(branchingRun(overlappingJobs))

    const a = model.rows.find((row) => row.nodeId === 'generateImage-1')?.bar
    const b = model.rows.find((row) => row.nodeId === 'generateImage-2')?.bar
    if (!a || !b) throw new Error('обе генерации обязаны получить полосу')

    // Перекрытие в координатах разметки, а не «на картинке»: начало каждой полосы
    // левее конца соседней — значит на экране они стоят одна над другой.
    expect(a.offset).toBeLessThan(b.offset + b.width)
    expect(b.offset).toBeLessThan(a.offset + a.width)
  })

  it('считает окна одновременной работы и экономию по данным, а не на глаз', () => {
    const model = buildTimeline(branchingRun(overlappingJobs))

    expect(model.peakConcurrency).toBe(2)
    expect(model.workMs).toBe(480)
    expect(model.busyMs).toBe(266)
    expect(model.savedMs).toBe(214)

    const [first] = model.overlaps
    expect(first).toEqual(expect.objectContaining({ startMs: 22, endMs: 230, peak: 2 }))
    expect(first?.offset).toBeCloseTo(22 / 282, 6)
    expect(first?.width).toBeCloseTo(208 / 282, 6)
  })

  it('последовательный прогон не выдумывает параллелизма', () => {
    const model = buildTimeline(
      branchingRun([job('prompt-1', 0, 10), job('generateImage-1', 10, 210)]),
    )

    expect(model.peakConcurrency).toBe(1)
    expect(model.overlaps).toEqual([])
    expect(model.savedMs).toBe(0)
  })

  it('незавершённый job тянется до «сейчас», а незапущенный остаётся строкой без полосы', () => {
    const model = buildTimeline(
      branchingRun([
        job('generateImage-1', 20, null, { status: 'running' }),
        job('generateImage-2', null, null, { status: 'queued' }),
      ]),
      { now: T0 + 120 },
    )

    const running = model.rows.find((row) => row.nodeId === 'generateImage-1')
    expect(running?.bar).toEqual(
      expect.objectContaining({ startMs: 20, endMs: 120, durationMs: 100, open: true }),
    )

    const queued = model.rows.find((row) => row.nodeId === 'generateImage-2')
    expect(queued?.bar).toBeNull()
    expect(queued?.status).toBe('queued')
  })

  it('запуск без job’ов даёт пустую модель, а не деление на ноль', () => {
    const model = buildTimeline(branchingRun([]))

    expect(model.rows).toEqual([])
    expect(model.spanMs).toBe(0)
    expect(model.ticks).toEqual([])
    expect(model.savedMs).toBe(0)
  })

  it('подписи оси кратны круглому шагу и не выходят за правый край', () => {
    const model = buildTimeline(branchingRun(overlappingJobs))

    expect(model.ticks.length).toBeGreaterThanOrEqual(2)
    expect(model.ticks[0]?.ms).toBe(0)
    for (const tick of model.ticks) {
      expect(tick.ms).toBeLessThanOrEqual(model.spanMs)
      expect(tick.offset).toBeCloseTo(tick.ms / model.spanMs, 6)
    }
  })
})
