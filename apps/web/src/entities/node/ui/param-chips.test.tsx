import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ParamChips } from './param-chips'

const OPTIONS = [
  { value: null, label: 'по умолчанию' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
]

describe('ряд чипов параметра', () => {
  it('показывает признак загрузки, когда чипы уже есть', () => {
    // список никогда не бывает пустым — первым всегда идёт «по умолчанию»,
    // поэтому сообщение «нет вариантов» состояние загрузки выразить не может
    render(
      <ParamChips
        label="Модель"
        options={[OPTIONS[0] ?? { value: null, label: 'по умолчанию' }]}
        value={null}
        onSelect={vi.fn()}
        pending
      />,
    )

    expect(screen.getByText(/загружаем/i)).toBeDefined()
  })

  it('признака загрузки нет, когда список приехал', () => {
    render(<ParamChips label="Модель" options={OPTIONS} value={null} onSelect={vi.fn()} />)

    expect(screen.queryByText(/загружаем/i)).toBeNull()
    expect(screen.getByText('GPT Image 2')).toBeDefined()
  })

  it('без вариантов показывает объяснение, а не пустое место', () => {
    render(
      <ParamChips
        label="Модель"
        options={[]}
        value={null}
        onSelect={vi.fn()}
        empty="модели недоступны"
      />,
    )

    expect(screen.getByText('модели недоступны')).toBeDefined()
  })
})
