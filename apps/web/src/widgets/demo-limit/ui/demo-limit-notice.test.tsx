import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HealthResponse } from '@workflow/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoLimitNotice } from './demo-limit-notice'

const health = (demo?: HealthResponse['demo']): HealthResponse => ({
  status: 'ok',
  database: 'up',
  redis: 'up',
  provider: demo?.exhausted === true ? 'fake' : 'openai',
  ...(demo === undefined ? {} : { demo }),
})

let client: QueryClient

const renderWith = (body: HealthResponse) => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    ),
  )
  return render(
    <QueryClientProvider client={client}>
      <DemoLimitNotice />
    </QueryClientProvider>,
  )
}

describe('плашка дневного лимита демонстрации', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('исчерпанный лимит объявляется вслух — подмена провайдера не бывает молчаливой', async () => {
    renderWith(health({ limit: 20, used: 20, exhausted: true }))

    expect(await screen.findByText(/дневной лимит демонстрации исчерпан/i)).not.toBeNull()
    expect(screen.getByText(/включён офлайн-провайдер/i)).not.toBeNull()
    // расход назван числами: «лимит исчерпан» без цифр невозможно проверить
    expect(screen.getByText(/20 из 20/)).not.toBeNull()
  })

  it('пока квота цела, плашки нет: сообщать не о чем', async () => {
    const { container } = renderWith(health({ limit: 20, used: 3, exhausted: false }))

    await waitFor(() => expect(client.getQueryData(['health'])).not.toBeUndefined())
    expect(container.innerHTML).toBe('')
  })

  it('на обычном запуске без предохранителя плашки нет', async () => {
    const { container } = renderWith(health())

    await waitFor(() => expect(client.getQueryData(['health'])).not.toBeUndefined())
    expect(container.innerHTML).toBe('')
  })
})
