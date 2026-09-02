import { describe, expect, it } from 'vitest'
import type { GenerateRequest } from '../ports/image-provider.js'
import { FakeProvider } from './fake-provider.js'

const request = (nodeId: string, runId = 'run-1'): GenerateRequest => ({
  prompt: 'кот',
  negativePrompt: null,
  references: [],
  model: null,
  aspectRatio: '1:1',
  origin: { runId, jobId: `${runId}:${nodeId}`, nodeId },
})

const generate = (provider: FakeProvider, nodeId: string, runId?: string): Promise<unknown> =>
  provider.generate(request(nodeId, runId), new AbortController().signal)

describe('FakeProvider', () => {
  it('рисует картинку по промпту, если ронять ноду не просили', async () => {
    const image = await generate(new FakeProvider(), 'generateImage-1')

    expect(image).toMatchObject({ mimeType: 'image/png' })
  })

  it('названная нода падает столько раз, сколько запусков её встретили', async () => {
    const provider = new FakeProvider({ failNodes: ['generateImage-1'] })

    await expect(generate(provider, 'generateImage-1', 'run-1')).rejects.toThrow(/generateImage-1/)
    await expect(generate(provider, 'generateImage-1', 'run-1')).rejects.toThrow(/generateImage-1/)
    await expect(generate(provider, 'generateImage-1', 'run-2')).rejects.toThrow(/generateImage-1/)
  })

  /*
   * Счётчик попыток нужен ровно для сценария ТЗ «нода упала → Retry»: без него
   * повтор упавшей ноды снаружи процесса ничем не кончается, кроме той же ошибки,
   * и восстановление невозможно ни показать на стенде, ни проверить в e2e.
   */
  it('с ограничением попыток падает только первая попытка, повтор проходит', async () => {
    const provider = new FakeProvider({ failNodes: [{ nodeId: 'editImage-1', times: 1 }] })

    await expect(generate(provider, 'editImage-1')).rejects.toThrow(/editImage-1/)
    await expect(generate(provider, 'editImage-1')).resolves.toMatchObject({
      mimeType: 'image/png',
    })
  })

  it('счётчик попыток свой у каждого запуска: сбой воспроизводится всегда, а не однажды', async () => {
    const provider = new FakeProvider({ failNodes: [{ nodeId: 'editImage-1', times: 1 }] })

    await expect(generate(provider, 'editImage-1', 'run-1')).rejects.toThrow(/editImage-1/)
    await expect(generate(provider, 'editImage-1', 'run-1')).resolves.toBeDefined()

    // второй запуск того же графа обязан снова начаться с ошибки
    await expect(generate(provider, 'editImage-1', 'run-2')).rejects.toThrow(/editImage-1/)
    await expect(generate(provider, 'editImage-1', 'run-2')).resolves.toBeDefined()
  })

  it('setFailingNodes обнуляет счётчики: список сбоев задаётся заново целиком', async () => {
    const provider = new FakeProvider({ failNodes: [{ nodeId: 'editImage-1', times: 1 }] })

    await expect(generate(provider, 'editImage-1')).rejects.toThrow(/editImage-1/)

    provider.setFailingNodes([{ nodeId: 'editImage-1', times: 1 }])
    await expect(generate(provider, 'editImage-1')).rejects.toThrow(/editImage-1/)
  })
})

describe('текст настроенного отказа', () => {
  const message = async (times: number): Promise<string> => {
    const provider = new FakeProvider({ failNodes: [{ nodeId: 'editImage-1', times }] })
    const error = await generate(provider, 'editImage-1').catch((cause: unknown) => cause)
    return error instanceof Error ? error.message : String(error)
  }

  // Сообщение видно на карточке ноды, поэтому числительное согласуется:
  // «падают первые 1 попытка» — то, что читатель принимает за небрежность в целом.
  it('одна попытка называется первой, а не «первые 1»', async () => {
    expect(await message(1)).toContain('в запуске падает первая попытка, эта — 1-я')
  })

  it('несколько попыток склоняются по числу', async () => {
    expect(await message(2)).toContain('в запуске падают первые 2 попытки')
    expect(await message(5)).toContain('в запуске падают первые 5 попыток')
    expect(await message(11)).toContain('в запуске падают первые 11 попыток')
  })
})
