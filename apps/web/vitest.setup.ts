import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Тесты не используют globals, поэтому автоочистку RTL подключаем руками.
afterEach(cleanup)

/*
 * Секунды по умолчанию на `findBy*` не хватает, когда vitest гонит все проекты
 * монорепо разом: запрос к замоканной сети успевает разрешиться, а машина —
 * нет. Тест, падающий от нагрузки, не сообщает ничего о коде.
 */
configure({ asyncUtilTimeout: 5000 })

/*
 * React Flow измеряет холст через ResizeObserver, которого в jsdom нет. Заглушка
 * ничего не сообщает: в тестах проверяется разметка и поведение, а не раскладка,
 * которую всё равно считает браузер.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}
