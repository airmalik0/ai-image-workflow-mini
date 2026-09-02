import type { JobError, JobStatus, NodeKind, RunState } from '@workflow/contracts'

/** Полоса job'а на шкале. Доли, а не пиксели: ширину трека знает только вёрстка. */
export interface TimelineBar {
  startMs: number
  endMs: number
  durationMs: number
  /** Доля от ширины шкалы, 0..1. */
  offset: number
  width: number
  /** Правая граница — «сейчас», а не конец job'а: он ещё выполняется. */
  open: boolean
}

export interface TimelineRow {
  jobId: string
  nodeId: string
  /** `null` — ноды нет в графе запуска: граф правили, а job остался. */
  kind: NodeKind | null
  status: JobStatus
  attempt: number
  error: JobError | null
  /** `null` — job ещё не начинался: строка есть, полосы нет. */
  bar: TimelineBar | null
}

/** Отрезок, на котором одновременно работали несколько job'ов. */
export interface TimelineWindow {
  startMs: number
  endMs: number
  offset: number
  width: number
  peak: number
}

export interface TimelineTick {
  ms: number
  offset: number
}

export interface TimelineModel {
  /** Длина шкалы: от старта run'а до конца последнего job'а. */
  spanMs: number
  rows: TimelineRow[]
  ticks: TimelineTick[]
  overlaps: TimelineWindow[]
  peakConcurrency: number
  /** Сумма длительностей всех job'ов — столько работы сделано. */
  workMs: number
  /** Длина объединения интервалов — столько времени хоть что-то выполнялось. */
  busyMs: number
  /**
   * `workMs - busyMs`: миллисекунды работы, прошедшие внахлёст с другой работой.
   * Ровно на столько параллельный прогон короче строго последовательного.
   */
  savedMs: number
}

interface Interval {
  startMs: number
  endMs: number
}

/** Круглые шаги оси. Берётся первый, при котором подписей не больше `MAX_TICKS`. */
const TICK_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000,
]
const MAX_TICKS = 6

const parseMoment = (value: string | null): number | null => {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

const chooseStep = (spanMs: number): number => {
  const step = TICK_STEPS.find((candidate) => spanMs / candidate <= MAX_TICKS)
  return step ?? TICK_STEPS[TICK_STEPS.length - 1] ?? 1
}

const buildTicks = (spanMs: number): TimelineTick[] => {
  if (spanMs <= 0) return []
  const step = chooseStep(spanMs)
  const ticks: TimelineTick[] = []
  for (let ms = 0; ms <= spanMs; ms += step) {
    ticks.push({ ms, offset: ms / spanMs })
  }
  return ticks
}

/**
 * Заметание отрезков слева направо: считает, сколько job'ов работало одновременно
 * в каждый момент. Конец отрезка обрабатывается раньше начала другого в ту же
 * миллисекунду — job, стартовавший ровно тогда, когда предыдущий закончился,
 * шёл после него, а не вместе с ним.
 */
const sweep = (
  intervals: Interval[],
): { busyMs: number; peak: number; overlaps: Omit<TimelineWindow, 'offset' | 'width'>[] } => {
  const events = intervals
    .flatMap(({ startMs, endMs }) => [
      { at: startMs, delta: 1 },
      { at: endMs, delta: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta)

  let concurrency = 0
  let previous = 0
  let busyMs = 0
  let peak = 0
  const overlaps: Omit<TimelineWindow, 'offset' | 'width'>[] = []

  for (const event of events) {
    const length = event.at - previous
    if (length > 0 && concurrency > 0) {
      busyMs += length
      if (concurrency >= 2) {
        const last = overlaps[overlaps.length - 1]
        // соседние отрезки с разной степенью параллелизма склеиваются в одно окно
        if (last !== undefined && last.endMs === previous) {
          last.endMs = event.at
          last.peak = Math.max(last.peak, concurrency)
        } else {
          overlaps.push({ startMs: previous, endMs: event.at, peak: concurrency })
        }
      }
    }
    concurrency += event.delta
    peak = Math.max(peak, concurrency)
    previous = event.at
  }

  return { busyMs, peak, overlaps }
}

/**
 * Диаграмма Ганта запуска: где на шкале стоит каждый job и где ветки шли внахлёст.
 *
 * Функция чистая и ничего не знает про вёрстку — именно поэтому параллелизм можно
 * проверить тестом на числах, а не глазами по картинке.
 */
export const buildTimeline = (state: RunState, options: { now?: number } = {}): TimelineModel => {
  const now = options.now ?? Date.now()
  const kinds = new Map<string, NodeKind>(state.run.graph.nodes.map((node) => [node.id, node.kind]))

  const started = state.jobs.flatMap((job) => {
    const startedAt = parseMoment(job.startedAt)
    if (startedAt === null) return []
    const finishedAt = parseMoment(job.finishedAt)
    const endsAt = Math.max(finishedAt ?? now, startedAt)
    return [{ job, startedAt, endsAt, open: finishedAt === null }]
  })

  const runStartedAt = parseMoment(state.run.startedAt)
  const earliestJob = Math.min(...started.map((entry) => entry.startedAt))
  const origin =
    started.length === 0 ? 0 : Math.min(earliestJob, runStartedAt ?? Number.POSITIVE_INFINITY)
  const spanMs =
    started.length === 0 ? 0 : Math.max(...started.map((entry) => entry.endsAt)) - origin

  const share = (ms: number): number => (spanMs <= 0 ? 0 : ms / spanMs)

  const bars = new Map<string, TimelineBar>(
    started.map(({ job, startedAt, endsAt, open }) => {
      const startMs = startedAt - origin
      const endMs = endsAt - origin
      return [
        job.id,
        {
          startMs,
          endMs,
          durationMs: endMs - startMs,
          offset: share(startMs),
          width: share(endMs - startMs),
          open,
        },
      ]
    }),
  )

  const rows: TimelineRow[] = state.jobs
    .map((job) => ({
      jobId: job.id,
      nodeId: job.nodeId,
      kind: kinds.get(job.nodeId) ?? null,
      status: job.status,
      attempt: job.attempt,
      error: job.error,
      bar: bars.get(job.id) ?? null,
    }))
    .sort(
      (a, b) =>
        (a.bar?.startMs ?? Number.POSITIVE_INFINITY) -
          (b.bar?.startMs ?? Number.POSITIVE_INFINITY) || a.nodeId.localeCompare(b.nodeId),
    )

  const intervals = [...bars.values()].map(({ startMs, endMs }) => ({ startMs, endMs }))
  const { busyMs, peak, overlaps } = sweep(intervals)
  const workMs = intervals.reduce((sum, interval) => sum + (interval.endMs - interval.startMs), 0)

  return {
    spanMs,
    rows,
    ticks: buildTicks(spanMs),
    overlaps: overlaps.map((window) => ({
      ...window,
      offset: share(window.startMs),
      width: share(window.endMs - window.startMs),
    })),
    peakConcurrency: peak,
    workMs,
    busyMs,
    savedMs: workMs - busyMs,
  }
}

/** Длительность в подписи: миллисекунды до секунды, дальше — секунды с одним знаком. */
export const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`

/** Строки, чьи полосы попадают в окно одновременной работы: кто именно шёл внахлёст. */
export const rowsInWindow = (rows: readonly TimelineRow[], window: TimelineWindow): TimelineRow[] =>
  rows.filter(
    (row) => row.bar !== null && row.bar.startMs < window.endMs && row.bar.endMs > window.startMs,
  )

/** Самое длинное окно одновременной работы — о нём и стоит говорить в выводе. */
export const widestOverlap = (model: TimelineModel): TimelineWindow | null =>
  model.overlaps.reduce<TimelineWindow | null>(
    (best, window) => (best === null || window.width > best.width ? window : best),
    null,
  )
