import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api'
import { parallelDemoRun, partialFailureDemoRun } from '../lib/demo-run'
import { RunTimelineView } from './run-timeline-view'

const barOf = (nodeId: string) => {
  const row = screen.getByRole('button', { name: new RegExp(nodeId) })
  const bar = within(row).getByTestId('timeline-bar')
  return {
    offset: Number(bar.dataset['offset']),
    width: Number(bar.dataset['width']),
  }
}

describe('таймлайн запуска', () => {
  it('без запуска объясняет, что здесь появится', () => {
    render(<RunTimelineView state={null} />)

    expect(screen.getByText('Запуска ещё не было')).toBeDefined()
    expect(screen.getByText(/полосы независимых веток/i)).toBeDefined()
  })

  it('сетевой сбой показывается с кодом, а не «что-то пошло не так»', () => {
    render(
      <RunTimelineView state={null} error={new ApiError('NETWORK_ERROR', 'Failed to fetch', 0)} />,
    )

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('NETWORK_ERROR')).toBeDefined()
    expect(within(alert).getByText('Failed to fetch')).toBeDefined()
  })

  it('полосы двух генераций перекрываются в разметке', () => {
    render(<RunTimelineView state={parallelDemoRun()} />)

    const a = barOf('generateImage-1')
    const b = barOf('generateImage-2')

    expect(a.offset).toBeLessThan(b.offset + b.width)
    expect(b.offset).toBeLessThan(a.offset + a.width)
    expect(screen.getByText(/выполнялись одновременно/)).toBeDefined()
    // окно одновременной работы нарисовано поверх строк — его и видит глаз
    expect(screen.getAllByTestId('overlap-band').length).toBeGreaterThanOrEqual(1)
  })

  it('ошибка провайдера показана с текстом и кодом, ветка-соседка остаётся успешной', () => {
    render(<RunTimelineView state={partialFailureDemoRun()} />)

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('PROVIDER_SAFETY_BLOCKED')).toBeDefined()
    expect(within(alert).getByText(/фильтром безопасности/)).toBeDefined()
    // пропущенный потомок остаётся строкой без полосы
    expect(screen.getByText('Пропущено')).toBeDefined()
  })

  it('клик по строке просит выделить ноду, выделенная строка помечена для чтения с экрана', () => {
    const onSelectNode = vi.fn()
    render(
      <RunTimelineView
        state={parallelDemoRun()}
        selectedNodeId="generateImage-2"
        onSelectNode={onSelectNode}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /generateImage-1/ }))
    expect(onSelectNode).toHaveBeenCalledWith('generateImage-1')

    expect(
      screen.getByRole('button', { name: /generateImage-2/ }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('повтор упавшей ноды доступен из разбора ошибок, а пропущенная в него не попадает', () => {
    const onRetry = vi.fn()
    render(<RunTimelineView state={partialFailureDemoRun()} onRetry={onRetry} />)

    // отказ один: пропуск потомка объясняет причину, но сам отказом не является
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)

    // ошибка неповторяемая — повтор предлагается честной формулировкой
    fireEvent.click(within(alerts[0] as HTMLElement).getByRole('button'))
    expect(onRetry).toHaveBeenCalledWith('generateImage-2')
  })

  it('шапку можно свернуть — полка не занимает экран, когда не нужна', () => {
    render(<RunTimelineView state={parallelDemoRun()} />)

    const toggle = screen.getByRole('button', { name: /Таймлайн запуска/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('timeline-bar')).toBeNull()
  })
})
