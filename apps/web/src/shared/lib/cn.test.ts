import { expect, it } from 'vitest'
import { cn } from './cn'

it('склеивает только заданные классы', () => {
  expect(cn('a', undefined, 'b', false, null, 'c')).toBe('a b c')
})

it('на пустом входе отдаёт пустую строку, а не undefined', () => {
  expect(cn()).toBe('')
})
