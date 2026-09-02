import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Button } from './button'

it('во время загрузки кнопка заблокирована и помечена aria-busy', () => {
  const onClick = vi.fn()
  render(
    <Button loading onClick={onClick}>
      Запустить
    </Button>,
  )
  const button = screen.getByRole('button', { name: /Запустить/ })
  expect(button.getAttribute('aria-busy')).toBe('true')
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

it('по умолчанию type=button — кнопка внутри формы её не отправляет', () => {
  render(<Button>Ок</Button>)
  expect(screen.getByRole('button').getAttribute('type')).toBe('button')
})
