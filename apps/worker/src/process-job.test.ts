import type { JobOutcomeMessage } from '@workflow/api'
import { FakeProvider, ProviderError } from '@workflow/core'
import type {
  DispatchPayload,
  EditRequest,
  ExecutionDeps,
  GenerateRequest,
  ImageProvider,
  ProviderImage,
} from '@workflow/core'
import { InMemoryFileStorage, InMemoryPresetRepository } from '@workflow/core/testing'
import { UnrecoverableError } from 'bullmq'
import type { Queue } from 'bullmq'
import { describe, expect, it } from 'vitest'
import type { CancellationSource } from './cancellation.js'
import { backoffDelay, processJob } from './process-job.js'

const payload: DispatchPayload = {
  runId: 'run-1',
  jobId: 'job-1',
  nodeId: 'g1',
  attempt: 1,
  node: {
    id: 'g1',
    kind: 'generateImage',
    position: { x: 0, y: 0 },
    data: { presetId: null, model: null, aspectRatio: '1:1' },
  },
  inputs: { prompt: { type: 'text', value: 'кот в скафандре' } },
}

/** Очередь результатов заменена журналом: проверяем, что и когда в неё уехало. */
function outcomesSpy(): { queue: Queue<JobOutcomeMessage>; sent: JobOutcomeMessage[] } {
  const sent: JobOutcomeMessage[] = []
  const queue = {
    add: (_name: string, data: JobOutcomeMessage) => {
      sent.push(data)
      return Promise.resolve({})
    },
  } as unknown as Queue<JobOutcomeMessage>
  return { queue, sent }
}

function cancellation(cancelled = false): CancellationSource & { controllers: AbortController[] } {
  const controllers: AbortController[] = []
  return {
    controllers,
    isCancelled: () => Promise.resolve(cancelled),
    track: () => {
      const controller = new AbortController()
      controllers.push(controller)
      return controller
    },
    release: () => undefined,
  }
}

class ThrowingProvider implements ImageProvider {
  readonly id = 'throwing'
  readonly models = []
  readonly defaultModel = 'throwing-1'
  readonly capabilities = { edit: true, referenceImages: 0, negativePrompt: false, aspectRatio: [] }
  calls = 0

  constructor(private readonly error: Error) {}

  generate(_req: GenerateRequest, _signal: AbortSignal): Promise<ProviderImage> {
    this.calls += 1
    return Promise.reject(this.error)
  }

  edit(_req: EditRequest, _signal: AbortSignal): Promise<ProviderImage> {
    return this.generate(_req, _signal)
  }
}

function execution(provider: ImageProvider): ExecutionDeps {
  return {
    providers: { forModel: () => provider },
    storage: new InMemoryFileStorage(),
    presets: new InMemoryPresetRepository(),
  }
}

describe('processJob', () => {
  it('успех уезжает в очередь результатов идентификатором файла, а не картинкой', async () => {
    const outcomes = outcomesSpy()
    const outcome = await processJob(
      {
        execution: execution(new FakeProvider()),
        outcomes: outcomes.queue,
        cancellation: cancellation(),
      },
      payload,
      { number: 1, allowed: 3 },
    )

    expect(outcome.status).toBe('success')
    expect(outcomes.sent).toHaveLength(1)
    expect(outcomes.sent[0]).toMatchObject({
      runId: 'run-1',
      nodeId: 'g1',
      outcome: { status: 'success', output: { type: 'image' } },
    })
    expect(JSON.stringify(outcomes.sent[0])).not.toContain('bytes')
  })

  it('транзиентную ошибку до последней попытки повторяет очередь, оркестратор о ней не узнаёт', async () => {
    const outcomes = outcomesSpy()
    const provider = new ThrowingProvider(
      new ProviderError('PROVIDER_RATE_LIMITED', 'слишком часто', true),
    )

    await expect(
      processJob(
        { execution: execution(provider), outcomes: outcomes.queue, cancellation: cancellation() },
        payload,
        { number: 1, allowed: 3 },
      ),
    ).rejects.toThrow('слишком часто')

    // ни одного результата: нода не должна мигать «упала — работает — упала»
    expect(outcomes.sent).toEqual([])
  })

  it('на последней попытке транзиентная ошибка становится результатом', async () => {
    const outcomes = outcomesSpy()
    const provider = new ThrowingProvider(
      new ProviderError('PROVIDER_RATE_LIMITED', 'слишком часто', true),
    )

    await expect(
      processJob(
        { execution: execution(provider), outcomes: outcomes.queue, cancellation: cancellation() },
        payload,
        { number: 3, allowed: 3 },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(outcomes.sent[0]?.outcome).toMatchObject({
      status: 'error',
      error: { code: 'PROVIDER_RATE_LIMITED', retryable: true },
    })
  })

  it('нетранзиентная ошибка не повторяется и не подменяется заглушкой', async () => {
    const outcomes = outcomesSpy()
    const provider = new ThrowingProvider(
      new ProviderError('PROVIDER_SAFETY_BLOCKED', 'запрос отклонён политикой', false),
    )

    await expect(
      processJob(
        { execution: execution(provider), outcomes: outcomes.queue, cancellation: cancellation() },
        payload,
        { number: 1, allowed: 3 },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(provider.calls).toBe(1)
    expect(outcomes.sent[0]?.outcome).toMatchObject({
      status: 'error',
      error: { code: 'PROVIDER_SAFETY_BLOCKED', retryable: false },
    })
  })

  it('отменённый запуск не исполняется вовсе', async () => {
    const outcomes = outcomesSpy()
    const provider = new FakeProvider()

    await expect(
      processJob(
        {
          execution: execution(provider),
          outcomes: outcomes.queue,
          cancellation: cancellation(true),
        },
        payload,
        { number: 1, allowed: 3 },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(provider.calls).toBe(0)
    expect(outcomes.sent).toEqual([])
  })

  it('прерванный отменой job не публикует результат: статус уже выставлен оркестратором', async () => {
    const outcomes = outcomesSpy()
    const provider = new FakeProvider({ latencyMs: 200 })
    const source = cancellation()

    const running = processJob(
      { execution: execution(provider), outcomes: outcomes.queue, cancellation: source },
      payload,
      { number: 1, allowed: 3 },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const controller of source.controllers) controller.abort()

    await expect(running).rejects.toBeInstanceOf(UnrecoverableError)
    expect(provider.aborted).toBe(1)
    expect(outcomes.sent).toEqual([])
  })
})

describe('backoffDelay', () => {
  it('растёт экспоненциально', () => {
    expect(backoffDelay(1)).toBeGreaterThanOrEqual(1000)
    expect(backoffDelay(1)).toBeLessThanOrEqual(1200)
    expect(backoffDelay(3)).toBeGreaterThanOrEqual(4000)
  })

  it('уважает Retry-After провайдера, если он больше своей формулы', () => {
    const error = new ProviderError('PROVIDER_RATE_LIMITED', 'подожди', true, {
      retryAfterMs: 30_000,
    })

    expect(backoffDelay(1, error)).toBe(30_000)
    // ...но не сокращает собственную задержку, если провайдер попросил меньше
    const short = new ProviderError('PROVIDER_RATE_LIMITED', 'подожди', true, { retryAfterMs: 10 })
    expect(backoffDelay(2, short)).toBeGreaterThanOrEqual(2000)
  })
})
