import { NODE_SPECS } from '@workflow/contracts'
import type {
  NodeKind,
  Position,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '@workflow/contracts'
import { edgeId } from '@/entities/workflow'

export const scenarioIds = ['linear', 'edit', 'branching'] as const

export type ScenarioId = (typeof scenarioIds)[number]

export interface Scenario {
  id: ScenarioId
  name: string
  /** Одна строка о том, что сценарий показывает и что от пользователя нужно. */
  summary: string
  /** Свежий граф на каждый вызов: загруженный сценарий правят, а образец остаётся. */
  build: () => WorkflowGraph
}

/**
 * Нода сценария. Параметры прогоняются через схему из `NODE_SPECS`, поэтому
 * сценарий физически не может разойтись с контрактом графа: незаполненные поля
 * получают значения по умолчанию оттуда же, откуда их берёт палитра.
 */
const node = <K extends NodeKind>(
  kind: K,
  id: string,
  position: Position,
  data: Record<string, unknown> = {},
): WorkflowNode =>
  ({ id, kind, position, data: NODE_SPECS[kind].params.parse(data) }) as WorkflowNode

/** Ребро с тем же идентификатором, что построил бы холст при ручном соединении. */
const edge = (
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): WorkflowEdge => {
  const connection = { source, sourceHandle, target, targetHandle }
  return { id: edgeId(connection), ...connection }
}

/* Колонки и ряды раскладки: сценарий должен читаться слева направо сразу после
   загрузки, без ручного растаскивания нод. */
const COL = [0, 360, 720]
const ROW = { single: 180, top: 0, bottom: 360 }

const DEMO_PROMPT =
  'Керамическая кружка на бетонной столешнице, мягкий боковой свет, минимализм, студийная съёмка'

const linear = (): WorkflowGraph => ({
  nodes: [
    node('prompt', 'prompt-1', { x: COL[0] ?? 0, y: ROW.single }, { text: DEMO_PROMPT }),
    node(
      'generateImage',
      'generateImage-1',
      { x: COL[1] ?? 0, y: ROW.single },
      {
        aspectRatio: '1:1',
      },
    ),
    node('result', 'result-1', { x: COL[2] ?? 0, y: ROW.single }),
  ],
  edges: [
    edge('prompt-1', 'text', 'generateImage-1', 'prompt'),
    edge('generateImage-1', 'image', 'result-1', 'image'),
  ],
})

const edit = (): WorkflowGraph => ({
  nodes: [
    node('imageInput', 'imageInput-1', { x: COL[0] ?? 0, y: ROW.single }),
    node(
      'editImage',
      'editImage-1',
      { x: COL[1] ?? 0, y: ROW.single },
      {
        instruction: 'Замени фон на светлый бетон, предмет и свет оставь без изменений',
      },
    ),
    node('result', 'result-1', { x: COL[2] ?? 0, y: ROW.single }),
  ],
  edges: [
    edge('imageInput-1', 'image', 'editImage-1', 'image'),
    edge('editImage-1', 'image', 'result-1', 'image'),
  ],
})

const branching = (): WorkflowGraph => ({
  nodes: [
    node('prompt', 'prompt-1', { x: COL[0] ?? 0, y: ROW.single }, { text: DEMO_PROMPT }),
    node(
      'generateImage',
      'generateImage-1',
      { x: COL[1] ?? 0, y: ROW.top },
      {
        aspectRatio: '1:1',
      },
    ),
    node(
      'generateImage',
      'generateImage-2',
      { x: COL[1] ?? 0, y: ROW.bottom },
      {
        aspectRatio: '16:9',
      },
    ),
    node('result', 'result-1', { x: COL[2] ?? 0, y: ROW.top }),
    node('result', 'result-2', { x: COL[2] ?? 0, y: ROW.bottom }),
  ],
  edges: [
    edge('prompt-1', 'text', 'generateImage-1', 'prompt'),
    edge('prompt-1', 'text', 'generateImage-2', 'prompt'),
    edge('generateImage-1', 'image', 'result-1', 'image'),
    edge('generateImage-2', 'image', 'result-2', 'image'),
  ],
})

/** Три сценария из задания. Порядок тот же, что на картинках в ТЗ. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'linear',
    name: 'Линейная генерация',
    summary: 'Промпт → генерация → результат. Самый короткий путь до картинки.',
    build: linear,
  },
  {
    id: 'edit',
    name: 'Редактирование',
    summary: 'Загрузите изображение в первую ноду — вторая изменит его по инструкции.',
    build: edit,
  },
  {
    id: 'branching',
    name: 'Ветвление',
    summary: 'Один промпт на две независимые генерации — они выполняются одновременно.',
    build: branching,
  },
]

export const findScenario = (id: ScenarioId): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.id === id)
