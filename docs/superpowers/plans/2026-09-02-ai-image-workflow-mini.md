# AI Image Workflow Mini — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Node-based редактор AI-workflow с реальной генерацией изображений: граф как данные, реактивный планировщик, очередь job'ов с ретраями, realtime-статусы и Canvas на React Flow.

**Architecture:** Монорепо pnpm. Доменное ядро (`packages/core`) не знает про I/O и содержит валидацию графа, планировщик и RequestBuilder. Оркестрация (API) отделена от исполнения (worker): API считает готовность нод и ставит job'ы в BullMQ, worker их выполняет и публикует события в Redis pub/sub, API транслирует их в браузер через SSE и WebSocket.

**Tech Stack:** TypeScript, pnpm workspaces, React 19 + Vite + `@xyflow/react` 12 + Zustand + TanStack Query (FSD), Fastify 5, Drizzle ORM + Postgres, BullMQ 6 + Redis, zod 4, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-02-ai-image-workflow-mini-design.md`

## Global Constraints

- **Язык кода и идентификаторов** — английский. Комментарии и документация — русский, кроме README, который двуязычен (RU основной).
- **Никаких секретов в репозитории.** Ключи только через переменные окружения. В репо лежит `.env.example` без значений. `.env` в `.gitignore`.
- **`packages/core` не импортирует** `fastify`, `drizzle-orm`, `bullmq`, `ioredis`, `node:fs`, `undici`, `fetch`. Только чистые структуры и порты. Это проверяется тестом на импорты.
- **Один источник правды для типов графа** — `packages/contracts`. Ни фронт, ни бэк не объявляют свои копии типов нод, портов и статусов.
- **Приложение обязано полностью работать без AI-ключа**: при отсутствии `GEMINI_API_KEY` активируется провайдер `fake`. Ни один тест в CI не ходит во внешние API.
- **Статусы job'а:** `idle | queued | running | success | error | skipped`. Статусы run'а: `queued | running | completed | failed | cancelled`.
- **Типы портов:** `text | image`. Несовместимые соединения блокируются и на фронте, и на бэке одной и той же функцией из `core`.
- **Каждая задача заканчивается коммитом** с осмысленным сообщением на русском в стиле Conventional Commits.
- **Node.js 22 LTS** в Docker-образах.

---

## Журнал прогресса

| Задача | Статус | Результат |
|---|---|---|
| 1. Каркас монорепо | ✅ `53eb747` | pnpm workspaces, строгий TS; откаты версий обоснованы в `docs/decisions.md` |
| 2. Контракты: ноды и порты | ✅ `00d09b5` | `NODE_SPECS` — декларативная топология портов |
| 3. Контракты: Preset, Run, Job | ✅ `07edefc` | схемы, события, единый конверт ошибок |
| 4. Валидация графа | ✅ `d4b374d` | циклы, типы портов, арность, достижимость |
| 5. Планировщик | ✅ `64f6882` | реактивная готовность, конус пропуска, retry-scope |
| 6. Порты и ошибки | ✅ `17f26aa` | порты провайдера, хранилищ, диспетчера; тест чистоты ядра |
| 7. RequestBuilder | ✅ `c7ff146` | слияние пресета и промпта, деградация по `capabilities` |
| 8. Движок запуска | ✅ `2fa2667` | семафор конкурентности, retry, отмена, fake-провайдер |
| 9. Схема БД и репозитории | ✅ `47149b5` | Drizzle + Postgres, `UNIQUE(run_id,node_id)`, сид 5 пресетов |
| 10. Файловое хранилище | ✅ `cdb9990` | адаптеры fs и s3; s3 проверен против живого MinIO |
| 11. Провайдеры OpenAI и Gemini | ✅ `97533d9` | на голом fetch; OpenAI прогнан вживую на всех трёх сценариях |
| 12. Каркас Fastify | ✅ `8eaad32` | конфиг на zod, `buildApp(deps)`, OpenAPI, логи с `runId` |
| 13. REST: пресеты, workflow, файлы | ✅ `de0e4ac` | multipart; 3 МБ и превышение лимита проверены живым curl |
| 14. Очередь и оркестрация | ✅ `b3d00cd` | BullMQ, отмена в три шага, авторетрай по `retryable` |
| 15. Realtime и воркер | ✅ `11430de` | Redis pub/sub, SSE с `id` и докачкой, WS, отдельный процесс |
| 16. Каркас web и дизайн-система | ✅ `4e51089` | токены с контрастом AA, границы слоёв роняют линт |
| 17. API-клиент и SSE-подписка | ✅ `43b8065` | докачка по `seq`, точечное обновление кэша |
| 18. Канвас на React Flow | ✅ `b4e037b` | пять нод, `canConnect` из ядра, ветвление, copy/paste |
| 19. Инспектор ноды | ✅ `33f2889` | форма из `NODE_SPECS` через `z.toJSONSchema`, матрица возможностей |
| 20. Запуск, статусы, retry | ✅ `1c414cf` | статусы в реальном времени, отмена, Retry, лайтбокс; живая генерация OpenAI 22,2 с |
| 21. Run Timeline | ✅ `f48fea3` | окна одновременной работы, честная арифметика экономии |
| 22. Сценарии и полировка | ✅ `10b781a` | три сценария из ТЗ, панель проблем, адаптив |
| 23. Docker | ✅ `947cd49` | чистый клон без `.env` → 60 с сборка, 10 с старт; SSE потоком доказан таймингами |
| Доводка: SSE, FAKE_FAIL_NODES, дневной лимит | ✅ | потолок попыток SSE; сбой заглушки задаётся окружением; `DEMO_DAILY_LIMIT` с объявлением в health и плашкой в UI |
| 24. E2E Playwright | ✅ | три сценария против docker-стенда через nginx; стенд поднимает `globalSetup`, сбой ноды — `FAKE_FAIL_NODES=editImage-1:1` |
| 25. CI GitHub Actions | ✅ | три джобы: проверки, тесты с живыми Postgres/Redis/MinIO и запретом пропусков, e2e против собранного стенда; прогон зелёный на чистом раннере |
| 26. README | ✅ | скриншоты настоящего прогона (ветвление на OpenAI, таймлайн, отказ и повтор), разбор по пунктам ТЗ, отступления, английская выжимка |
| 27. Демо-стенд | ✅ | http://209.38.214.79 — дроплет `aiwf-demo` (fra1, 1 ГБ + 2 ГБ swap), развёрнут из опубликованного тарбола, боевой OpenAI с суточным потолком 25; сквозной сценарий прогнан на стенде (1024×1024 за 27 с) |

**444 теста** при поднятых Postgres и Redis (415 + 22 пропущенных без Redis) плюс **3 e2e**
против собранного стенда. `lint` / `typecheck` / `build` / `format` чистые.

## Порядок исполнения

Задачи 1–8 строго последовательны: они создают контракты и ядро, от которых зависит всё остальное.
Задачи 9–15 (backend) и 16–22 (frontend) после задачи 8 можно вести параллельно — они не пересекаются
по файлам. Задачи 23–27 (упаковка, тесты, деплой) — в конце.

---

### Task 1: Каркас монорепо

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, `.editorconfig`
- Create: `eslint.config.js`, `.prettierrc`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Create: `vitest.workspace.ts`

**Interfaces:**
- Produces: рабочие команды `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` в корне.

- [ ] **Step 1: Инициализировать workspace**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Корневой `package.json` — приватный, с `"type": "module"`, скриптами `lint`/`typecheck`/`test`/`build`,
рекурсивно вызывающими одноимённые скрипты пакетов.

- [ ] **Step 2: Базовый tsconfig**

`tsconfig.base.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`,
`"exactOptionalPropertyTypes": true`, `"moduleResolution": "bundler"`, `"target": "ES2023"`,
`"verbatimModuleSyntax": true`.

Строгость здесь не украшение: `noUncheckedIndexedAccess` ловит именно те ошибки, которые типичны
при работе с графом (обращение к `nodes[id]` без проверки).

- [ ] **Step 3: Проверить, что версии зависимостей совместимы**

Установить: `typescript`, `vitest`, `zod@^4`, `eslint`, `prettier`, `@types/node`.
Запустить `pnpm typecheck` на пустых пакетах.

Если TypeScript мажорной версии ломает сборку — зафиксировать последнюю мажорную версию,
на которой всё зелёное, и записать причину в `docs/decisions.md`.

- [ ] **Step 4: Пустые пакеты собираются**

Run: `pnpm -r build && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: каркас монорепо на pnpm workspaces"
```

---

### Task 2: Контракты — граф, ноды, порты

**Files:**
- Create: `packages/contracts/src/graph/port.ts`
- Create: `packages/contracts/src/graph/node-specs.ts`
- Create: `packages/contracts/src/graph/graph.ts`
- Test: `packages/contracts/src/graph/graph.test.ts`

**Interfaces:**
- Produces:
  - `type PortType = 'text' | 'image'`
  - `type NodeKind = 'prompt' | 'imageInput' | 'generateImage' | 'editImage' | 'result'`
  - `const NODE_SPECS: Record<NodeKind, NodeSpec>`
  - `interface NodeSpec { inputs: Record<string, PortSpec>; outputs: Record<string, PortSpec>; params: ZodType }`
  - `interface PortSpec { type: PortType; required: boolean }`
  - `const workflowGraphSchema: ZodType<WorkflowGraph>`
  - типы `WorkflowNode`, `WorkflowEdge`, `WorkflowGraph`

- [ ] **Step 1: Написать падающий тест на схему графа**

```ts
import { describe, expect, it } from 'vitest'
import { workflowGraphSchema, NODE_SPECS } from './index.js'

describe('workflowGraphSchema', () => {
  it('принимает минимальный валидный граф', () => {
    const graph = {
      nodes: [
        { id: 'n1', kind: 'prompt', position: { x: 0, y: 0 }, data: { text: 'кот' } },
        { id: 'n2', kind: 'result', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', sourceHandle: 'text', target: 'n2', targetHandle: 'image' },
      ],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('отвергает неизвестный тип ноды', () => {
    const graph = { nodes: [{ id: 'n1', kind: 'wat', position: { x: 0, y: 0 }, data: {} }], edges: [] }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
  })
})

describe('NODE_SPECS', () => {
  it('описывает все пять типов нод', () => {
    expect(Object.keys(NODE_SPECS).sort()).toEqual(
      ['editImage', 'generateImage', 'imageInput', 'prompt', 'result'],
    )
  })

  it('generateImage принимает text на входе и отдаёт image', () => {
    expect(NODE_SPECS.generateImage.inputs.prompt).toEqual({ type: 'text', required: true })
    expect(NODE_SPECS.generateImage.outputs.image).toEqual({ type: 'image', required: false })
  })

  it('editImage требует image и допускает необязательный text', () => {
    expect(NODE_SPECS.editImage.inputs.image.required).toBe(true)
    expect(NODE_SPECS.editImage.inputs.instruction.required).toBe(false)
  })
})
```

Обрати внимание: тест на схему намеренно НЕ проверяет совместимость типов портов
(в первом кейсе `text` соединён с `image`). Схема отвечает только за структуру;
семантика — задача валидатора из Task 4. Это разделение и проверяется.

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `pnpm --filter @workflow/contracts test`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать**

`NODE_SPECS` — единственное место, где описана топология портов:

```ts
export const NODE_SPECS = {
  prompt: {
    inputs: {},
    outputs: { text: { type: 'text', required: false } },
    params: z.object({ text: z.string().max(3000).default('') }),
  },
  imageInput: {
    inputs: {},
    outputs: { image: { type: 'image', required: false } },
    params: z.object({ fileId: z.string().nullable().default(null) }),
  },
  generateImage: {
    inputs: { prompt: { type: 'text', required: true } },
    outputs: { image: { type: 'image', required: false } },
    params: z.object({
      presetId: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
      aspectRatio: z.string().default('1:1'),
    }),
  },
  editImage: {
    inputs: {
      image: { type: 'image', required: true },
      instruction: { type: 'text', required: false },
    },
    outputs: { image: { type: 'image', required: false } },
    params: z.object({
      instruction: z.string().max(3000).default(''),
      presetId: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
    }),
  },
  result: {
    inputs: { image: { type: 'image', required: true } },
    outputs: {},
    params: z.object({}),
  },
} as const satisfies Record<NodeKind, NodeSpec>
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/contracts test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): декларативное описание типов нод и портов"
```

---

### Task 3: Контракты — Preset, Run, Job, события

**Files:**
- Create: `packages/contracts/src/preset.ts`
- Create: `packages/contracts/src/run.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/api.ts`
- Test: `packages/contracts/src/run.test.ts`

**Interfaces:**
- Consumes: типы из Task 2.
- Produces:
  - `presetSchema`, `type Preset`
  - `type JobStatus`, `type RunStatus`, `jobSchema`, `runSchema`
  - `type RunEvent = { seq: number; runId: string } & ({ type: 'run.started'; ... } | { type: 'job.updated'; job: Job } | { type: 'run.finished'; status: RunStatus })`
  - схемы запросов/ответов всех эндпоинтов: `createRunRequestSchema`, `runStateSchema`, `validateGraphResponseSchema`, `errorEnvelopeSchema`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest'
import { jobStatuses, runStatuses, runEventSchema } from './index.js'

it('набор статусов job фиксирован', () => {
  expect(jobStatuses).toEqual(['idle', 'queued', 'running', 'success', 'error', 'skipped'])
})

it('набор статусов run фиксирован', () => {
  expect(runStatuses).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled'])
})

it('событие job.updated разбирается и несёт монотонный seq', () => {
  const parsed = runEventSchema.safeParse({
    seq: 1,
    runId: 'r1',
    type: 'job.updated',
    job: {
      id: 'j1', runId: 'r1', nodeId: 'n1', status: 'running', attempt: 1,
      startedAt: new Date().toISOString(), finishedAt: null, output: null, error: null,
    },
  })
  expect(parsed.success).toBe(true)
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @workflow/contracts test`
Expected: FAIL

- [ ] **Step 3: Реализовать схемы**

`errorEnvelopeSchema` — единый конверт ошибок: `{ error: { code: string, message: string, details?: unknown } }`.
Коды перечислить константой `ERROR_CODES` (`GRAPH_INVALID`, `RUN_NOT_FOUND`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_SAFETY_BLOCKED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `FILE_NOT_FOUND`, `VALIDATION_FAILED`).

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/contracts test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): схемы пресетов, запусков, job'ов и событий"
```

---

### Task 4: Ядро — валидация графа

**Files:**
- Create: `packages/core/src/graph/validate.ts`
- Create: `packages/core/src/graph/adjacency.ts`
- Test: `packages/core/src/graph/validate.test.ts`

**Interfaces:**
- Consumes: `WorkflowGraph`, `NODE_SPECS`, `PortType` из `@workflow/contracts`.
- Produces:
  - `function validateGraph(graph: WorkflowGraph): ValidationResult`
  - `interface ValidationResult { errors: ValidationIssue[]; warnings: ValidationIssue[] }`
  - `interface ValidationIssue { code: string; message: string; nodeId?: string; edgeId?: string }`
  - `function canConnect(graph, conn: { source, sourceHandle, target, targetHandle }): { ok: true } | { ok: false; reason: string }`
  - `function buildAdjacency(graph): { incoming: Map<string, WorkflowEdge[]>; outgoing: Map<string, WorkflowEdge[]> }`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, it } from 'vitest'
import { validateGraph, canConnect } from './validate.js'

const node = (id: string, kind: string, data: unknown = {}) =>
  ({ id, kind, position: { x: 0, y: 0 }, data }) as never

describe('validateGraph', () => {
  it('находит цикл и называет участвующие ноды', () => {
    const graph = {
      nodes: [node('a', 'generateImage'), node('b', 'editImage')],
      edges: [
        { id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' },
        { id: 'e2', source: 'b', sourceHandle: 'image', target: 'a', targetHandle: 'prompt' },
      ],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
  })

  it('запрещает соединение image → text', () => {
    const graph = {
      nodes: [node('a', 'imageInput'), node('b', 'generateImage')],
      edges: [{ id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'prompt' }],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'PORT_TYPE_MISMATCH' && e.edgeId === 'e1')).toBe(true)
  })

  it('требует подключения обязательного входа', () => {
    const graph = { nodes: [node('a', 'result')], edges: [] }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'REQUIRED_INPUT_MISSING' && e.nodeId === 'a')).toBe(true)
  })

  it('запрещает два источника на одном входном порту', () => {
    const graph = {
      nodes: [node('p1', 'prompt'), node('p2', 'prompt'), node('g', 'generateImage')],
      edges: [
        { id: 'e1', source: 'p1', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
        { id: 'e2', source: 'p2', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
      ],
    }
    const { errors } = validateGraph(graph as never)
    expect(errors.some((e) => e.code === 'INPUT_PORT_OVERSUBSCRIBED')).toBe(true)
  })

  it('разрешает ветвление одного выхода в несколько входов', () => {
    const graph = {
      nodes: [node('p', 'prompt'), node('a', 'generateImage'), node('b', 'generateImage'),
              node('ra', 'result'), node('rb', 'result')],
      edges: [
        { id: 'e1', source: 'p', sourceHandle: 'text', target: 'a', targetHandle: 'prompt' },
        { id: 'e2', source: 'p', sourceHandle: 'text', target: 'b', targetHandle: 'prompt' },
        { id: 'e3', source: 'a', sourceHandle: 'image', target: 'ra', targetHandle: 'image' },
        { id: 'e4', source: 'b', sourceHandle: 'image', target: 'rb', targetHandle: 'image' },
      ],
    }
    expect(validateGraph(graph as never).errors).toEqual([])
  })

  it('предупреждает о ноде, не ведущей к result', () => {
    const graph = {
      nodes: [node('p', 'prompt'), node('g', 'generateImage'), node('r', 'result'), node('lost', 'prompt')],
      edges: [
        { id: 'e1', source: 'p', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
        { id: 'e2', source: 'g', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
      ],
    }
    const { errors, warnings } = validateGraph(graph as never)
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.code === 'NODE_NOT_CONTRIBUTING' && w.nodeId === 'lost')).toBe(true)
  })

  it('требует хотя бы одну result-ноду', () => {
    const graph = { nodes: [node('p', 'prompt')], edges: [] }
    expect(validateGraph(graph as never).errors.some((e) => e.code === 'NO_RESULT_NODE')).toBe(true)
  })
})

describe('canConnect', () => {
  it('отклоняет соединение несовместимых типов', () => {
    const graph = { nodes: [node('a', 'imageInput'), node('b', 'generateImage')], edges: [] }
    const res = canConnect(graph as never,
      { source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'prompt' })
    expect(res.ok).toBe(false)
  })

  it('отклоняет соединение, создающее цикл', () => {
    const graph = {
      nodes: [node('a', 'generateImage'), node('b', 'editImage')],
      edges: [{ id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' }],
    }
    const res = canConnect(graph as never,
      { source: 'b', sourceHandle: 'image', target: 'a', targetHandle: 'prompt' })
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @workflow/core test`
Expected: FAIL

- [ ] **Step 3: Реализовать**

Обнаружение циклов — DFS с тремя состояниями (`white`/`gray`/`black`); при встрече `gray`-вершины
собрать цикл из стека и вернуть его в `details`. Достижимость — обратный обход от всех `result`-нод.
`canConnect` переиспользует проверку типов и проверку цикла на графе с гипотетически добавленным ребром.

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/core test`
Expected: PASS, 9 тестов

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): валидация графа — циклы, типы портов, арность, достижимость"
```

---

### Task 5: Ядро — планировщик

**Files:**
- Create: `packages/core/src/run/planner.ts`
- Test: `packages/core/src/run/planner.test.ts`

**Interfaces:**
- Consumes: `buildAdjacency` из Task 4, `JobStatus` из contracts.
- Produces:
  - `function computeReadyJobs(graph: WorkflowGraph, jobs: JobState[]): string[]` — nodeId, готовые к запуску
  - `function computeSkipCone(graph: WorkflowGraph, failedNodeId: string): string[]` — транзитивные потомки
  - `function computeRunStatus(jobs: JobState[]): RunStatus`
  - `function computeRetryScope(graph: WorkflowGraph, nodeId: string): string[]` — нода и её потомки
  - `interface JobState { nodeId: string; status: JobStatus }`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, it } from 'vitest'
import { computeReadyJobs, computeSkipCone, computeRunStatus, computeRetryScope } from './planner.js'

// prompt → (A, B) → (RA, RB): классическое ветвление из ТЗ
const branching = {
  nodes: ['p', 'a', 'b', 'ra', 'rb'].map((id) => ({ id, kind: 'prompt', position: { x: 0, y: 0 }, data: {} })),
  edges: [
    { id: 'e1', source: 'p', sourceHandle: 'text', target: 'a', targetHandle: 'prompt' },
    { id: 'e2', source: 'p', sourceHandle: 'text', target: 'b', targetHandle: 'prompt' },
    { id: 'e3', source: 'a', sourceHandle: 'image', target: 'ra', targetHandle: 'image' },
    { id: 'e4', source: 'b', sourceHandle: 'image', target: 'rb', targetHandle: 'image' },
  ],
} as never

const jobs = (m: Record<string, string>) =>
  Object.entries(m).map(([nodeId, status]) => ({ nodeId, status })) as never

it('на старте готов только корень', () => {
  expect(computeReadyJobs(branching, jobs({ p: 'idle', a: 'idle', b: 'idle', ra: 'idle', rb: 'idle' })))
    .toEqual(['p'])
})

it('после корня готовы ОБЕ ветки одновременно', () => {
  const ready = computeReadyJobs(branching,
    jobs({ p: 'success', a: 'idle', b: 'idle', ra: 'idle', rb: 'idle' }))
  expect(ready.sort()).toEqual(['a', 'b'])
})

it('быстрая ветка не ждёт медленную соседку', () => {
  // A уже success, B ещё running — RA обязан быть готов немедленно
  const ready = computeReadyJobs(branching,
    jobs({ p: 'success', a: 'success', b: 'running', ra: 'idle', rb: 'idle' }))
  expect(ready).toEqual(['ra'])
})

it('нода с несколькими входами ждёт все', () => {
  const diamond = {
    nodes: ['p', 'img', 'edit', 'r'].map((id) => ({ id, kind: 'prompt', position: { x: 0, y: 0 }, data: {} })),
    edges: [
      { id: 'e1', source: 'p', sourceHandle: 'text', target: 'edit', targetHandle: 'instruction' },
      { id: 'e2', source: 'img', sourceHandle: 'image', target: 'edit', targetHandle: 'image' },
      { id: 'e3', source: 'edit', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
    ],
  } as never
  expect(computeReadyJobs(diamond, jobs({ p: 'success', img: 'running', edit: 'idle', r: 'idle' })))
    .toEqual([])
})

it('конус пропуска — все транзитивные потомки упавшей ноды', () => {
  expect(computeSkipCone(branching, 'p').sort()).toEqual(['a', 'b', 'ra', 'rb'])
  expect(computeSkipCone(branching, 'a').sort()).toEqual(['ra'])
})

it('retry-scope включает саму ноду и её потомков', () => {
  expect(computeRetryScope(branching, 'a').sort()).toEqual(['a', 'ra'])
})

it('run завершён успешно, только если нет ошибок и незавершённых', () => {
  expect(computeRunStatus(jobs({ a: 'success', b: 'success' }))).toBe('completed')
  expect(computeRunStatus(jobs({ a: 'success', b: 'running' }))).toBe('running')
  expect(computeRunStatus(jobs({ a: 'error', b: 'skipped' }))).toBe('failed')
  expect(computeRunStatus(jobs({ a: 'success', b: 'skipped' }))).toBe('failed')
})
```

Третий тест — центральный. Он отделяет реактивный планировщик от волнового: при волновом
исполнении `ra` ждала бы завершения всей волны, то есть ветки `b`.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @workflow/core test planner`
Expected: FAIL

- [ ] **Step 3: Реализовать**

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/core test planner`
Expected: PASS, 7 тестов

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): реактивный планировщик готовности нод"
```

---

### Task 6: Ядро — порты и нормализация ошибок

**Files:**
- Create: `packages/core/src/ports/image-provider.ts`
- Create: `packages/core/src/ports/file-storage.ts`
- Create: `packages/core/src/ports/repositories.ts`
- Create: `packages/core/src/ports/job-dispatcher.ts`
- Create: `packages/core/src/errors.ts`
- Test: `packages/core/src/errors.test.ts`
- Test: `packages/core/src/ports/purity.test.ts`

**Interfaces:**
- Produces:
  - `interface ImageProvider { id; models; capabilities; generate(req, signal); edit(req, signal) }`
  - `interface GenerateRequest { prompt: string; negativePrompt: string | null; references: ImageRef[]; model: string; aspectRatio: string }`
  - `interface EditRequest extends GenerateRequest { image: ImageRef }`
  - `interface ProviderImage { bytes: Uint8Array; mimeType: string; model: string; meta: Record<string, unknown> }`
  - `class ProviderError extends Error { code: ErrorCode; retryable: boolean }`
  - `interface FileStorage { put(bytes, mimeType): Promise<string>; get(id): Promise<{ bytes; mimeType }>; url(id): string }`
  - `interface PresetRepository`, `interface WorkflowRepository`, `interface RunRepository`
  - `interface JobDispatcher { dispatch(job: DispatchPayload): Promise<void>; cancel(runId: string): Promise<void> }`

- [ ] **Step 1: Написать тест на чистоту ядра**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = ['fastify', 'drizzle-orm', 'bullmq', 'ioredis', 'node:fs', 'undici', '@google/genai']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

it('доменное ядро не зависит от инфраструктуры', () => {
  const offenders = walk(new URL('..', import.meta.url).pathname)
    .filter((file) => FORBIDDEN.some((dep) => readFileSync(file, 'utf8').includes(`from '${dep}`)))
  expect(offenders).toEqual([])
})
```

Этот тест — не формальность. Он не даст «на пять минут» затащить драйвер БД в домен,
а именно так чистые ядра обычно и умирают.

- [ ] **Step 2: Тест на нормализацию ошибок**

```ts
import { describe, expect, it } from 'vitest'
import { ProviderError, isRetryable } from './errors.js'

it('429 и 5xx считаются транзиентными', () => {
  expect(isRetryable(new ProviderError('PROVIDER_RATE_LIMITED', 'too many', true))).toBe(true)
})

it('safety-блокировка не ретраится', () => {
  expect(isRetryable(new ProviderError('PROVIDER_SAFETY_BLOCKED', 'blocked', false))).toBe(false)
})
```

- [ ] **Step 3: Реализовать порты и ошибки**

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): порты провайдера, хранилищ и диспетчера, нормализация ошибок"
```

---

### Task 7: Ядро — RequestBuilder

**Files:**
- Create: `packages/core/src/preset/request-builder.ts`
- Test: `packages/core/src/preset/request-builder.test.ts`

**Interfaces:**
- Consumes: `Preset` из contracts, `GenerateRequest` из Task 6.
- Produces: `function buildProviderRequest(input: BuildInput): GenerateRequest`
  где `interface BuildInput { userPrompt: string; preset: Preset | null; params: GenerateParams; capabilities: ProviderCapabilities }`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, it } from 'vitest'
import { buildProviderRequest } from './request-builder.js'

const preset = {
  id: 'p1', name: 'Premium 3D',
  mainPrompt: 'premium minimal 3D visual',
  negativePrompt: 'clutter, noisy background',
  references: ['ref-1', 'ref-2'],
  defaults: { model: 'model-a', aspectRatio: '3:4' },
} as never

const caps = { edit: true, referenceImages: 4, negativePrompt: true, aspectRatio: ['1:1', '3:4'] }

it('склеивает промпт пресета с пользовательским, пресет впереди', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка на столе', preset, params: {} as never, capabilities: caps,
  })
  expect(req.prompt).toBe('premium minimal 3D visual, кружка на столе')
})

it('без пресета отдаёт только пользовательский промпт', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка', preset: null, params: {} as never, capabilities: caps,
  })
  expect(req.prompt).toBe('кружка')
  expect(req.negativePrompt).toBeNull()
  expect(req.references).toEqual([])
})

it('параметры ноды перекрывают defaults пресета', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка', preset,
    params: { aspectRatio: '1:1' } as never, capabilities: caps,
  })
  expect(req.aspectRatio).toBe('1:1')
  expect(req.model).toBe('model-a')
})

it('если провайдер не умеет negativePrompt — вклеивает его в промпт', () => {
  const req = buildProviderRequest({
    userPrompt: 'кружка', preset, params: {} as never,
    capabilities: { ...caps, negativePrompt: false },
  })
  expect(req.negativePrompt).toBeNull()
  expect(req.prompt).toContain('The scene must not contain: clutter, noisy background')
})

it('обрезает референсы до лимита провайдера', () => {
  const many = { ...preset, references: ['a', 'b', 'c', 'd', 'e'] } as never
  const req = buildProviderRequest({
    userPrompt: 'x', preset: many, params: {} as never,
    capabilities: { ...caps, referenceImages: 2 },
  })
  expect(req.references).toHaveLength(2)
})

it('пустой пользовательский промпт при непустом пресете допустим', () => {
  const req = buildProviderRequest({
    userPrompt: '', preset, params: {} as never, capabilities: caps,
  })
  expect(req.prompt).toBe('premium minimal 3D visual')
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @workflow/core test request-builder`
Expected: FAIL

- [ ] **Step 3: Реализовать**

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/core test request-builder`
Expected: PASS, 6 тестов

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): RequestBuilder — слияние пресета, промпта и параметров ноды"
```

---

### Task 8: Ядро — движок запуска и доказательство параллелизма

**Files:**
- Create: `packages/core/src/run/engine.ts`
- Create: `packages/core/src/providers/fake-provider.ts`
- Test: `packages/core/src/run/engine.test.ts`

**Interfaces:**
- Consumes: планировщик (Task 5), порты (Task 6).
- Produces:
  - `class RunEngine { constructor(deps: { dispatcher: JobDispatcher; repo: RunRepository; clock: Clock }) }`
  - `RunEngine.start(runId): Promise<void>` — ставит первую волну
  - `RunEngine.onJobFinished(runId, nodeId, outcome): Promise<void>` — пересчитывает и ставит следующие
  - `RunEngine.retryNode(runId, nodeId): Promise<void>`
  - `class FakeProvider implements ImageProvider` с опциями `{ latencyMs, failNodes }`

- [ ] **Step 1: Написать тест на параллелизм**

```ts
import { describe, expect, it } from 'vitest'

it('две независимые ветки выполняются одновременно', async () => {
  // граф: prompt → (A, B); FakeProvider с задержкой 200 мс на генерацию,
  // диспетчер с concurrency = 2
  const started = Date.now()
  await runToCompletion(branchingGraph, { latencyMs: 200, concurrency: 2 })
  const elapsed = Date.now() - started

  expect(elapsed).toBeLessThan(350)   // последовательно было бы ≥ 400
})

it('при concurrency = 1 те же ветки выполняются последовательно', async () => {
  const started = Date.now()
  await runToCompletion(branchingGraph, { latencyMs: 200, concurrency: 1 })
  expect(Date.now() - started).toBeGreaterThanOrEqual(400)
})
```

Второй тест обязателен: без него первый мог бы проходить просто потому, что задержка не работает.
Пара тестов доказывает, что параллелизм действительно управляется, а не случаен.

- [ ] **Step 2: Тесты на поведение при сбоях**

```ts
it('падение ноды переводит потомков в skipped, а соседнюю ветку не трогает', async () => {
  const state = await runToCompletion(branchingGraph, { failNodes: ['a'] })
  expect(state.jobs.a.status).toBe('error')
  expect(state.jobs.ra.status).toBe('skipped')
  expect(state.jobs.b.status).toBe('success')
  expect(state.jobs.rb.status).toBe('success')
  expect(state.run.status).toBe('failed')
})

it('retry упавшей ноды не пересчитывает успешных предков', async () => {
  const engine = await runToFailure(branchingGraph, { failNodes: ['a'] })
  const promptCallsBefore = engine.provider.callsFor('p')
  await engine.retryNode('a')
  expect(engine.provider.callsFor('p')).toBe(promptCallsBefore)
  expect(engine.state.jobs.a.status).toBe('success')
  expect(engine.state.jobs.ra.status).toBe('success')
})

it('отмена run переводит незапущенные job в skipped и прерывает работающие', async () => {
  const engine = startRun(branchingGraph, { latencyMs: 500 })
  await engine.cancel()
  expect(engine.state.run.status).toBe('cancelled')
})
```

- [ ] **Step 3: Реализовать `FakeProvider` и `RunEngine`**

`FakeProvider` генерирует детерминированное изображение: PNG фиксированного размера, цвет
выводится из хеша промпта, поверх — текст промпта. Никакой сети. Опции `latencyMs` и `failNodes`
делают его пригодным и для тайминговых, и для сценарных тестов.

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @workflow/core test engine`
Expected: PASS, 5 тестов

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): движок запуска графа и fake-провайдер"
```

---

## Backend (задачи 9–15)

### Task 9: Persistence — Drizzle, схема, репозитории

**Files:**
- Create: `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/repositories/{preset,workflow,run}.repository.ts`
- Create: `apps/api/src/db/seed.ts`
- Test: `apps/api/src/db/repositories/run.repository.test.ts`

**Interfaces:**
- Consumes: интерфейсы репозиториев из `packages/core` (Task 6).
- Produces: реализации `PresetRepository`, `WorkflowRepository`, `RunRepository` на Drizzle;
  `runMigrations()`, `seedPresets()`.

Таблицы: `presets`, `workflows`, `runs`, `jobs`, `files`.
`jobs` имеет уникальный индекс `(run_id, node_id)` — это защита от двойной постановки одного job'а.

Тесты репозиториев идут против реального Postgres из `docker compose`, поднимаемого в CI как service.
Ин-мемори реализации репозиториев живут в `packages/core/src/testing/` и используются в тестах ядра.

- [ ] Step 1: Написать схему и миграцию, применить локально
- [ ] Step 2: Написать тест: создать run, обновить статус job'а, прочитать состояние
- [ ] Step 3: Реализовать репозитории
- [ ] Step 4: `pnpm --filter @workflow/api test db` → PASS
- [ ] Step 5: Commit `feat(api): схема БД, репозитории и сид пресетов`

---

### Task 10: FileStorage — адаптеры fs и s3

**Files:**
- Create: `apps/api/src/storage/fs-storage.ts`, `apps/api/src/storage/s3-storage.ts`, `apps/api/src/storage/index.ts`
- Test: `apps/api/src/storage/fs-storage.test.ts`

**Interfaces:**
- Produces: `createFileStorage(config): FileStorage` — выбор адаптера по `STORAGE_DRIVER`.

- [ ] Step 1: Тест: `put` → `get` возвращает те же байты и mimeType; `get` несуществующего → `FILE_NOT_FOUND`
- [ ] Step 2: Реализовать `fs`-адаптер (запись в `DATA_DIR`, имя файла — хеш содержимого)
- [ ] Step 3: Реализовать `s3`-адаптер на `@aws-sdk/client-s3` (совместим с Yandex/MinIO/R2)
- [ ] Step 4: Тесты зелёные
- [ ] Step 5: Commit `feat(api): файловое хранилище с адаптерами fs и s3`

---

### Task 11: Провайдеры OpenAI и Gemini

**Files:**
- Create: `apps/api/src/providers/openai/openai-provider.ts`
- Create: `apps/api/src/providers/openai/error-mapping.ts`
- Create: `apps/api/src/providers/gemini/gemini-provider.ts`
- Create: `apps/api/src/providers/gemini/error-mapping.ts`
- Create: `apps/api/src/providers/registry.ts`
- Test: `apps/api/src/providers/openai/error-mapping.test.ts`
- Test: `apps/api/src/providers/gemini/error-mapping.test.ts`

**Interfaces:**
- Consumes: `ImageProvider`, `ProviderError` из core.
- Produces: `class OpenAiProvider implements ImageProvider`, `class GeminiProvider implements ImageProvider`;
  `createProviderRegistry(env): Map<string, ImageProvider>`.

**OpenAI** — модель `gpt-image-2`, проверена живыми запросами (см. `docs/research/openai-images.md`):
`POST /v1/images/generations` для text→image и `POST /v1/images/edits` (`multipart/form-data`,
повторяющееся поле `image[]`) для редактирования и для нескольких референсов одним запросом.
Ответ — base64 в `data[0].b64_json`. Поля negative prompt нет, деградация через `RequestBuilder`.

Выбор активного провайдера — `IMAGE_PROVIDER` (`auto` → первый доступный в порядке `openai` → `gemini` → `fake`).
Модель выбирается на уровне ноды, а не один раз на процесс: в UI это чип рядом с промптом.

Точные эндпоинты, тела запросов, форматы ответов и коды ошибок — в `docs/research/gemini-api.md`
(результат живого спайка на ~150 запросах, лежит в репозитории). Реализация обязана им соответствовать.

**Реализация на голом `fetch`, без `@google/genai`.** Обоснование в отчёте: SDK тянет 29 МБ ради одного
POST'а, его `httpOptions.timeout` мутирует глобальный undici-диспетчер процесса, ретраи по умолчанию
выключены, а гугловый JSON ошибки завёрнут в `message` строкой — структурный разбор всё равно писать руками.

Ключевые факты, которые обязаны быть отражены в коде:

- Эндпоинт `POST /v1beta/models/{model}:generateContent`, ключ в заголовке `x-goog-api-key`.
- Модель по умолчанию для обеих операций — `gemini-3.1-flash-image`.
- В запросе обязателен `generationConfig.responseModalities: ['IMAGE']` — иначе модель добавляет
  болтливый текстовый парт перед картинкой.
- **Отказ модели приходит с HTTP 200.** Картинку искать перебором `parts` в поиске `inlineData`,
  а не по `parts[0]`. Отсутствие `inlineData` — это ошибка, `finishReason` бывает `NO_IMAGE`,
  `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION`, `IMAGE_OTHER`, `PROHIBITED_CONTENT`,
  `SAFETY`. Разные модели на один и тот же запрещённый промпт дают разный `finishReason`.
- **Два разных 429.** Если в `error.details[]` есть `RetryInfo` — это RPM-квота, ретраить с задержкой
  из `retryDelay`. Если `details` нет — кончились деньги, ретрай бесполезен, `retryable: false`.
  Заголовка `Retry-After` в ответе нет.
- Поля `negativePrompt` у API **не существует** — это подтверждено discovery-документом. Негатив
  вклеивается в текст промпта силами `RequestBuilder` (Task 7).
- Размер и аспект — только `generationConfig.imageConfig.{aspectRatio,imageSize}`. Валидировать
  на своей стороне: `gemini-2.5-flash-image` молча игнорирует любое значение `imageSize`.
- Таймаут HTTP: 90 с для 1K, 180 с для 2K/4K. Отмена через `AbortSignal`.
- Все ошибки нормализуются в `ProviderError` с корректным `retryable`.
- Юнит-тесты покрывают **только маппинг ошибок** на зафиксированных телах ответов из отчёта;
  сеть в тестах не дёргается.

- [ ] Step 1: Тесты маппинга ошибок на реальных телах ответов из `docs/research/gemini-api.md`
- [ ] Step 2: Реализовать провайдер
- [ ] Step 3: Тесты зелёные
- [ ] Step 4: Ручная проверка одной живой генерации, скриншот/файл в `docs/research/`
- [ ] Step 5: Commit `feat(api): провайдер Google Gemini с нормализацией ошибок`

---

### Task 12: Каркас Fastify — конфиг, health, ошибки, OpenAPI

**Files:**
- Create: `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Create: `apps/api/src/plugins/{error-handler,openapi,cors}.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/routes/health.test.ts`

**Interfaces:**
- Produces: `buildApp(deps): FastifyInstance` — принимает зависимости явно, чтобы тесты
  подставляли `fake`-провайдер и in-memory репозитории без моков модулей.

Конфиг — zod-схема поверх `process.env`, падает на старте при неверных значениях.
Выбор провайдера: `IMAGE_PROVIDER` (`auto` по умолчанию — `openai`, затем `gemini`, иначе `fake`).

- [ ] Step 1: Тест `GET /api/health` → 200, тело `{ status, database, redis, provider }`
- [ ] Step 2: Реализовать конфиг, приложение, обработчик ошибок в едином конверте
- [ ] Step 3: Подключить OpenAPI из zod-схем на `/api/docs`
- [ ] Step 4: Тесты зелёные
- [ ] Step 5: Commit `feat(api): каркас Fastify, конфигурация и обработка ошибок`

---

### Task 13: REST — пресеты, workflows, валидация, файлы

**Files:**
- Create: `apps/api/src/routes/{presets,workflows,files}.ts`
- Test: `apps/api/src/routes/{presets,workflows}.test.ts`

Загрузка — **`multipart/form-data`**, а не base64 в JSON. Лимит размера задаётся явно
(`MAX_UPLOAD_BYTES`, по умолчанию 15 МБ) и возвращает внятную ошибку, а не 500.

- [ ] Step 1: Тесты: CRUD пресета; `POST /api/workflows/validate` на графе с циклом возвращает `GRAPH_INVALID` и указывает ноды
- [ ] Step 2: Реализовать роуты
- [ ] Step 3: Тест загрузки файла: `POST /api/files` с картинкой → `GET /api/files/:id` отдаёт те же байты
- [ ] Step 4: **Тест на файле реального размера — сгенерировать JPEG ~3 МБ и загрузить.** Иконка в 2 КБ ничего не доказывает: типичная ошибка здесь — упереться в дефолтный лимит тела запроса и получить 500 на первой же фотографии с телефона
- [ ] Step 5: Тест превышения лимита: файл больше `MAX_UPLOAD_BYTES` → 413 с кодом в конверте ошибки
- [ ] Step 6: Тесты зелёные
- [ ] Step 7: Commit `feat(api): REST для пресетов, workflow и файлов`

---

### Task 14: Runs — оркестрация поверх BullMQ

**Files:**
- Create: `apps/api/src/runs/orchestrator.ts`
- Create: `apps/api/src/queue/{queue,dispatcher}.ts`
- Create: `apps/api/src/routes/runs.ts`
- Test: `apps/api/src/routes/runs.test.ts`

**Interfaces:**
- Consumes: `RunEngine` из core, `JobDispatcher` из core.
- Produces: `BullMqDispatcher implements JobDispatcher`; роуты `POST /api/runs`, `GET /api/runs/:id`,
  `POST /api/runs/:id/cancel`, `POST /api/runs/:id/nodes/:nodeId/retry`.

Автоматический retry настраивается на уровне BullMQ: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`.
Нетранзиентные ошибки помечаются `UnrecoverableError`, чтобы BullMQ не повторял их.

Конкурентность воркера ограничена `MAX_CONCURRENT_JOBS` (по умолчанию 4). Без потолка граф из двадцати
независимых генераций превращается в двадцать одновременных запросов к провайдеру — у AI-провайдеров
лимиты жёсткие (у fal на новом аккаунте два параллельных запроса), и результатом будет шквал 429,
а не ускорение.

- [ ] Step 1: Интеграционный тест: `POST /api/runs` с графом ветвления на fake-провайдере → оба результата `success`
- [ ] Step 2: Тест: невалидный граф → 400 `GRAPH_INVALID`, run не создаётся
- [ ] Step 3: Реализовать оркестратор и диспетчер
- [ ] Step 4: Тесты retry и cancel через HTTP
- [ ] Step 5: Тест: после retry упавшей ноды статус run'а пересчитывается по **всем** job'ам — run не может стать `completed`, пока хоть одна нода не выполнена
- [ ] Step 6: Commit `feat(api): запуск графа, очередь job'ов, retry и отмена`

---

### Task 15: Realtime — Redis pub/sub, SSE, WebSocket; worker

**Files:**
- Create: `apps/api/src/realtime/{event-bus,sse,ws}.ts`
- Create: `apps/worker/src/index.ts`, `apps/worker/src/process-job.ts`
- Test: `apps/api/src/realtime/sse.test.ts`

**Interfaces:**
- Produces: `RunEventBus { publish(event); subscribe(runId, handler) }` на Redis pub/sub;
  `GET /api/runs/:id/events` (SSE, `Last-Event-ID`), `GET /api/ws?runId=…`.

Каждое событие получает монотонный `seq` в пределах run'а; последние N событий хранятся,
чтобы переподключившийся клиент догнал пропущенное по `Last-Event-ID`.

Обязательно: поле `id:` в каждом SSE-кадре (без него браузер не пришлёт `Last-Event-ID`, и докачка
существует только на бумаге), кольцевой буфер истории, который **не очищается при retry**, heartbeat
против обрыва по таймауту простоя. Изображения в поток не идут — только `fileId`.

- [ ] Step 1: Тест: подписка на SSE получает `job.updated` в порядке возрастания `seq`
- [ ] Step 2: Тест: переподключение с `Last-Event-ID` не теряет и не дублирует события
- [ ] Step 3: Тест: после retry история прошлых событий сохраняется — поздний подписчик видит, что нода падала
- [ ] Step 4: Реализовать шину, SSE и WS
- [ ] Step 5: Реализовать worker: резолв входов → RequestBuilder → провайдер → storage → событие
- [ ] Step 6: Commit `feat: realtime-статусы через Redis pub/sub, SSE и WebSocket`

---

## Frontend (задачи 16–22)

### Task 16: Каркас web — Vite, FSD, дизайн-токены

**Files:**
- Create: `apps/web/` (vite, tsconfig, index.html)
- Create: `apps/web/src/app/`, `apps/web/src/shared/{ui,lib,config,api}/`
- Create: `apps/web/src/app/styles/tokens.css`
- Create: `apps/web/eslint.config.js` с `eslint-plugin-boundaries`

**Interfaces:**
- Produces: правило импортов FSD, проверяемое линтером; набор дизайн-токенов; базовые компоненты
  `Button`, `Field`, `StatusPill`, `Chip`, `Panel` в `shared/ui`.

- [ ] Step 1: Настроить Vite + React 19 + TS, поднять пустое приложение
- [ ] Step 2: Настроить `eslint-plugin-boundaries`: `shared → entities → features → widgets → pages → app`
- [ ] Step 3: Тест линтера: намеренный импорт из `features` в `shared` роняет `pnpm lint`
- [ ] Step 4: Дизайн-токены и базовые компоненты
- [ ] Step 5: Commit `feat(web): каркас приложения на FSD с проверкой границ слоёв`

---

### Task 17: API-клиент и подписка на события

**Files:**
- Create: `apps/web/src/shared/api/{http,sse,types}.ts`
- Create: `apps/web/src/entities/run/model/use-run-stream.ts`

- [ ] Step 1: Типобезопасный http-клиент поверх схем из `@workflow/contracts`
- [ ] Step 2: SSE-подписка с автопереподключением и `Last-Event-ID`
- [ ] Step 3: Хук, обновляющий кэш TanStack Query точечно по `job.updated`
- [ ] Step 4: Тест хука на замоканном `EventSource`
- [ ] Step 5: Commit `feat(web): API-клиент и realtime-подписка на события запуска`

---

### Task 18: Канвас — React Flow, кастомные ноды, соединения

**Files:**
- Create: `apps/web/src/entities/workflow/model/workflow-store.ts` (Zustand)
- Create: `apps/web/src/entities/node/ui/` — по компоненту на тип ноды
- Create: `apps/web/src/widgets/workflow-canvas/`
- Create: `apps/web/src/features/{add-node,connect-nodes}/`

**Interfaces:**
- Consumes: `canConnect`, `validateGraph` из `@workflow/core`.
- Produces: контролируемый React Flow; add / move / connect / delete / branching / selection.

- [ ] Step 1: Канвас с точечной сеткой, controls, minimap
- [ ] Step 2: Пять кастомных нод с типизированными хэндлами
- [ ] Step 3: `isValidConnection` вызывает `canConnect` из ядра; несовместимый порт не соединяется
- [ ] Step 4: Палитра нод, добавление, удаление, копирование
- [ ] Step 5: Commit `feat(web): канвас на React Flow с типизированными портами`

---

### Task 19: Инспектор ноды, пресеты, загрузка изображений

**Files:**
- Create: `apps/web/src/widgets/node-inspector/`
- Create: `apps/web/src/entities/preset/`
- Create: `apps/web/src/features/{select-preset,select-model,upload-image}/`

- [ ] Step 1: Инспектор строит форму из `NODE_SPECS[kind].params` — не хардкодит поля
- [ ] Step 2: Промпт со счётчиком символов `0 / 3000`
- [ ] Step 3: Выбор пресета и модели чипами внутри ноды `generateImage`
- [ ] Step 4: Загрузка изображения для `imageInput` с превью
- [ ] Step 5: Commit `feat(web): инспектор ноды, выбор пресета и модели`

---

### Task 20: Запуск, статусы, результаты, retry

**Files:**
- Create: `apps/web/src/features/{run-workflow,retry-job,cancel-run}/`
- Create: `apps/web/src/entities/job/ui/status-pill.tsx`

- [ ] Step 1: Кнопка Run: валидация графа локально → `POST /api/runs` → подписка на события
- [ ] Step 2: Статус на каждой ноде: `idle / queued / running / success / error / skipped`
- [ ] Step 3: Превью результата прямо в ноде `result`, полноразмерный просмотр по клику
- [ ] Step 4: Кнопка Retry на упавшей ноде, кнопка Cancel на запущенном run'е
- [ ] Step 5: Commit `feat(web): запуск графа, статусы нод, retry и отмена`

---

### Task 21: Run Timeline

**Files:**
- Create: `apps/web/src/widgets/run-timeline/`

Диаграмма Ганта по `startedAt`/`finishedAt` job'ов. Это визуальное доказательство параллелизма:
полосы `Generate A` и `Generate B` перекрываются по времени.

- [ ] Step 1: Компонент таймлайна, ось времени в миллисекундах от старта run'а
- [ ] Step 2: Полосы job'ов с цветом по статусу, подсказка с длительностью и номером попытки
- [ ] Step 3: Подсветка выбранной ноды синхронно с канвасом
- [ ] Step 4: Проверить на реальном запуске с ветвлением, что перекрытие видно
- [ ] Step 5: Commit `feat(web): таймлайн запуска как визуальное доказательство параллелизма`

---

### Task 22: Готовые сценарии и полировка UI

**Files:**
- Create: `apps/web/src/features/load-scenario/`
- Modify: `apps/web/src/pages/editor/`

Три сценария в один клик — ровно те, что нарисованы в ТЗ: линейная генерация,
редактирование изображения, обязательное ветвление в две параллельные генерации.

- [ ] Step 1: Три предзаготовленных графа
- [ ] Step 2: Пустое состояние редактора предлагает выбрать сценарий
- [ ] Step 3: Обработка ошибок в UI: сетевые сбои, невалидный граф, ошибка провайдера с текстом
- [ ] Step 4: Полировка: анимации статусов, адаптив от 1280px, фокус-стили, aria-атрибуты
- [ ] Step 5: Commit `feat(web): готовые сценарии и полировка интерфейса`

---

## Упаковка (задачи 23–27)

### Task 23: Docker и одна команда запуска

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`

Сервисы: `postgres`, `redis`, `api`, `worker`, `web`. Зависимости по `healthcheck`.
Миграции и сид — автоматически при старте `api`.

- [ ] Step 1: Multi-stage Dockerfile, общий для api/worker/web
- [ ] Step 2: `docker compose up` на чистой машине поднимает всё; проверить `docker compose down -v` и повторный старт
- [ ] Step 3: Проверить работу **без** `GEMINI_API_KEY` — приложение обязано подняться на `fake`
- [ ] Step 4: Проверить полный сценарий ветвления через браузер в docker-сборке
- [ ] Step 5: Commit `chore: запуск всего стека одной командой docker compose up`

---

### Task 24: E2E-тесты Playwright

**Files:**
- Create: `e2e/{branching,retry}.spec.ts`, `playwright.config.ts`

- [ ] Step 1: Тест: собрать граф ветвления мышью, запустить, дождаться двух картинок
- [ ] Step 2: Тест: несовместимый порт не соединяется
- [ ] Step 3: Тест: упавшая нода показывает ошибку, Retry доводит её до success
- [ ] Step 4: Прогнать против docker-сборки на `fake`-провайдере
- [ ] Step 5: Commit `test: e2e-сценарии ветвления, валидации портов и retry`

---

### Task 25: CI

**Files:**
- Create: `.github/workflows/ci.yml`

Джобы: lint → typecheck → unit → build → integration (postgres + redis как services) → e2e.
Ключи не требуются: всё на `fake`-провайдере.

- [ ] Step 1: Написать workflow
- [ ] Step 2: Запушить, дождаться зелёного прогона
- [ ] Step 3: Добавить бейдж в README
- [ ] Step 4: Commit `ci: сборка, тесты и e2e в GitHub Actions`

---

### Task 26: README

**Files:**
- Create: `README.md`, `docs/architecture.md`, `docs/decisions.md`

README обязан содержать:
1. Запуск в одну команду и явное «работает без AI-ключа».
2. Скриншот/GIF ветвления и Run Timeline.
3. Схему архитектуры и разделение оркестрации и исполнения.
4. Разбор по пунктам ТЗ: что сделано и где лежит.
5. Отступления и их причины: добавленный статус `skipped`, выбор SSE, отсутствие Preset Editor.
6. Что сознательно не сделано (раздел 13 спеки).
7. Как подключить другого провайдера — на примере файла.
8. Абзац о том, как велась разработка с AI-агентом и как результат верифицировался.

- [ ] Step 1: Написать README
- [ ] Step 2: Записать GIF работы
- [ ] Step 3: Проверить инструкцию запуска на чистом клоне репозитория
- [ ] Step 4: Commit `docs: README, архитектура и журнал решений`

---

### Task 27: Демо-стенд

- [ ] Step 1: Выбрать площадку с поддержкой Docker, Postgres, Redis и S3-совместимого хранилища
- [ ] Step 2: Развернуть, включить рейт-лимит на запуск run'ов
- [ ] Step 3: Проверить полный сценарий на живом стенде
- [ ] Step 4: Добавить ссылку в README
- [ ] Step 5: Commit `docs: ссылка на демо-стенд`

---

## Self-Review

**Покрытие спеки:**

| Раздел спеки | Задачи |
|---|---|
| 2. Архитектура, монорепо | 1 |
| 3.1 Граф, ноды, порты | 2 |
| 3.2 Preset | 3, 9, 13, 19 |
| 3.3 Run и Job | 3, 9, 14 |
| 4.1 Валидация | 4 |
| 4.2 Планировщик | 5 |
| 4.3 Параллелизм и доказательство | 8, 21 |
| 4.4 Retry | 8, 14, 20 |
| 4.5 Отмена | 8, 14, 20 |
| 5. REST API | 12, 13, 14 |
| 6. Realtime | 15, 17 |
| 7. Провайдеры и RequestBuilder | 6, 7, 8, 11 |
| 8. Хранилища | 9, 10 |
| 9. Frontend FSD | 16–20 |
| 10. UI | 18–22 |
| 11. Тестирование | 4–8, 13–15, 24, 25 |
| 12. Запуск | 23 |
| 13. Что не делается | 26 |

Пробелов не найдено.

**Открытый пункт спеки, влияющий на план:** второй провайдер (fal/Seedream) добавляется отдельной
задачей после Task 11 — только если разведка подтвердит доступность моделей. Без подтверждения
задача не создаётся, и это отражается в README.
