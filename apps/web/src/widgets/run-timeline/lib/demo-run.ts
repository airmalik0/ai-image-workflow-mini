import type { Job, RunState, WorkflowGraph } from '@workflow/contracts'

/**
 * Показательный запуск ветвящегося графа из ТЗ. Нужен там, где таймлайн надо
 * увидеть без поднятого бэкенда: витрина дизайн-системы и тесты разметки.
 * Времена взяты из живого прогона Gemini, а не придуманы ровными.
 */
const DEMO_GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'prompt-1', kind: 'prompt', position: { x: 0, y: 160 }, data: { text: 'Кружка' } },
    {
      id: 'generateImage-1',
      kind: 'generateImage',
      position: { x: 320, y: 40 },
      data: { presetId: 'preset-demo', model: null, aspectRatio: '1:1' },
    },
    {
      id: 'generateImage-2',
      kind: 'generateImage',
      position: { x: 320, y: 280 },
      data: { presetId: 'preset-demo', model: null, aspectRatio: '16:9' },
    },
    { id: 'result-1', kind: 'result', position: { x: 660, y: 40 }, data: {} },
    { id: 'result-2', kind: 'result', position: { x: 660, y: 280 }, data: {} },
  ],
  edges: [
    {
      id: 'prompt-1.text--generateImage-1.prompt',
      source: 'prompt-1',
      sourceHandle: 'text',
      target: 'generateImage-1',
      targetHandle: 'prompt',
    },
    {
      id: 'prompt-1.text--generateImage-2.prompt',
      source: 'prompt-1',
      sourceHandle: 'text',
      target: 'generateImage-2',
      targetHandle: 'prompt',
    },
    {
      id: 'generateImage-1.image--result-1.image',
      source: 'generateImage-1',
      sourceHandle: 'image',
      target: 'result-1',
      targetHandle: 'image',
    },
    {
      id: 'generateImage-2.image--result-2.image',
      source: 'generateImage-2',
      sourceHandle: 'image',
      target: 'result-2',
      targetHandle: 'image',
    },
  ],
}

const ORIGIN = Date.parse('2026-09-02T12:00:00.000Z')

const moment = (ms: number | null): string | null =>
  ms === null ? null : new Date(ORIGIN + ms).toISOString()

const demoJob = (
  nodeId: string,
  startMs: number | null,
  endMs: number | null,
  rest: Partial<Job> = {},
): Job => ({
  id: `job-${nodeId}`,
  runId: 'run-demo',
  nodeId,
  status: 'success',
  attempt: 1,
  startedAt: moment(startMs),
  finishedAt: moment(endMs),
  output: null,
  error: null,
  ...rest,
})

const demoRun = (status: RunState['run']['status'], finishedMs: number, jobs: Job[]): RunState => ({
  run: {
    id: 'run-demo',
    workflowId: null,
    status,
    graph: DEMO_GRAPH,
    createdAt: moment(-40) ?? '',
    startedAt: moment(0),
    finishedAt: moment(finishedMs),
  },
  jobs,
})

/** Обе генерации идут внахлёст: ради этой картинки таймлайн и написан. */
export const parallelDemoRun = (): RunState =>
  demoRun('completed', 6506, [
    demoJob('prompt-1', 0, 4, { output: { type: 'text', value: 'Кружка' } }),
    demoJob('generateImage-1', 12, 5230, { output: { type: 'image', fileId: 'demo-a' } }),
    demoJob('generateImage-2', 14, 6480, {
      attempt: 2,
      output: { type: 'image', fileId: 'demo-b' },
    }),
    demoJob('result-1', 5240, 5252),
    demoJob('result-2', 6492, 6506),
  ])

/** Упала одна ветка: соседняя дошла до конца, а потомки упавшей — `skipped`. */
export const partialFailureDemoRun = (): RunState =>
  demoRun('failed', 5252, [
    demoJob('prompt-1', 0, 4, { output: { type: 'text', value: 'Кружка' } }),
    demoJob('generateImage-1', 12, 5230, { output: { type: 'image', fileId: 'demo-a' } }),
    demoJob('generateImage-2', 14, 1890, {
      status: 'error',
      attempt: 3,
      error: {
        code: 'PROVIDER_SAFETY_BLOCKED',
        message: 'Gemini вернул пустой inlineData: запрос отклонён фильтром безопасности',
        retryable: false,
      },
    }),
    demoJob('result-1', 5240, 5252),
    demoJob('result-2', null, null, { status: 'skipped', attempt: 0 }),
  ])
