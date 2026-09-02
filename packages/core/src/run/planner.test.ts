import { expect, it } from 'vitest'
import {
  computeReadyJobs,
  computeSkipCone,
  computeRunStatus,
  computeRetryScope,
} from './planner.js'

// prompt → (A, B) → (RA, RB): классическое ветвление из ТЗ
const branching = {
  nodes: ['p', 'a', 'b', 'ra', 'rb'].map((id) => ({
    id,
    kind: 'prompt',
    position: { x: 0, y: 0 },
    data: {},
  })),
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
  expect(
    computeReadyJobs(branching, jobs({ p: 'idle', a: 'idle', b: 'idle', ra: 'idle', rb: 'idle' })),
  ).toEqual(['p'])
})

it('после корня готовы ОБЕ ветки одновременно', () => {
  const ready = computeReadyJobs(
    branching,
    jobs({ p: 'success', a: 'idle', b: 'idle', ra: 'idle', rb: 'idle' }),
  )
  expect(ready.sort()).toEqual(['a', 'b'])
})

it('быстрая ветка не ждёт медленную соседку', () => {
  // A уже success, B ещё running — RA обязан быть готов немедленно
  const ready = computeReadyJobs(
    branching,
    jobs({ p: 'success', a: 'success', b: 'running', ra: 'idle', rb: 'idle' }),
  )
  expect(ready).toEqual(['ra'])
})

it('нода с несколькими входами ждёт все', () => {
  const diamond = {
    nodes: ['p', 'img', 'edit', 'r'].map((id) => ({
      id,
      kind: 'prompt',
      position: { x: 0, y: 0 },
      data: {},
    })),
    edges: [
      { id: 'e1', source: 'p', sourceHandle: 'text', target: 'edit', targetHandle: 'instruction' },
      { id: 'e2', source: 'img', sourceHandle: 'image', target: 'edit', targetHandle: 'image' },
      { id: 'e3', source: 'edit', sourceHandle: 'image', target: 'r', targetHandle: 'image' },
    ],
  } as never
  expect(
    computeReadyJobs(diamond, jobs({ p: 'success', img: 'running', edit: 'idle', r: 'idle' })),
  ).toEqual([])
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
