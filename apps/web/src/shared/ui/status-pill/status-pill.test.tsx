import { jobStatuses } from '@workflow/contracts'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { STATUS_LABELS, StatusPill } from './status-pill'

it('у каждого статуса из контрактов есть подпись', () => {
  for (const status of jobStatuses) {
    expect(STATUS_LABELS[status]).toBeTruthy()
  }
  expect(Object.keys(STATUS_LABELS)).toHaveLength(jobStatuses.length)
})

it('рисует подпись статуса', () => {
  render(<StatusPill status="running" />)
  expect(screen.getByText('Выполняется')).toBeTruthy()
})

it('подпись можно заменить, не теряя статус', () => {
  const { container } = render(<StatusPill status="success" label="1.8 с" />)
  expect(screen.getByText('1.8 с')).toBeTruthy()
  expect(container.querySelector('svg')).toBeTruthy()
})
