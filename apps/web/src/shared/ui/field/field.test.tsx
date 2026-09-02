import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Field } from './field'

it('счётчик показывает длину и лимит', () => {
  render(<Field label="Промпт" value="кот" onChange={() => {}} maxLength={3000} />)
  expect(screen.getByText('3 / 3000')).toBeTruthy()
})

it('без maxLength счётчика нет', () => {
  render(<Field label="Имя" value="кот" onChange={() => {}} />)
  expect(screen.queryByText(/\//)).toBeNull()
})

it('ошибка помечает поле как невалидное и выводится текстом', () => {
  render(<Field label="Имя" value="" onChange={() => {}} error="Обязательное поле" />)
  const input = screen.getByLabelText('Имя')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('Обязательное поле')).toBeTruthy()
})

it('многострочное поле отдаёт введённый текст наверх', () => {
  const onChange = vi.fn()
  render(<Field label="Промпт" value="" onChange={onChange} multiline />)
  fireEvent.change(screen.getByLabelText('Промпт'), { target: { value: 'кружка' } })
  expect(onChange).toHaveBeenCalledWith('кружка')
})
