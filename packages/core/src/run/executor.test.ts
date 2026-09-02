import { workflowGraphSchema } from '@workflow/contracts'
import type { ModelDescriptor, Preset, WorkflowNode } from '@workflow/contracts'
import { expect, it } from 'vitest'
import type {
  EditRequest,
  GenerateRequest,
  ImageProvider,
  ProviderCapabilities,
  ProviderImage,
  ProviderSelector,
  ResolvedInputs,
} from '../ports/index.js'
import { InMemoryFileStorage, InMemoryPresetRepository } from '../testing/index.js'
import { executeNode } from './executor.js'

/**
 * Провайдер, подписывающий результат своим идентификатором. Настоящий FakeProvider
 * здесь не годится: проверяется выбор между двумя провайдерами, а у двух его
 * экземпляров одинаковые модели и неотличимые картинки.
 */
class SigningProvider implements ImageProvider {
  readonly models: readonly ModelDescriptor[]
  readonly defaultModel: string
  readonly capabilities: ProviderCapabilities
  /** Запросы, которые провайдеру действительно достались. */
  readonly requests: GenerateRequest[] = []

  constructor(
    readonly id: string,
    models: readonly string[],
    capabilities: Partial<ProviderCapabilities> = {},
  ) {
    this.models = models.map((model) => ({
      id: model,
      providerId: id,
      label: model,
      supportsEdit: true,
    }))
    this.defaultModel = models[0] ?? id
    this.capabilities = {
      edit: true,
      referenceImages: 0,
      negativePrompt: false,
      aspectRatio: [],
      ...capabilities,
    }
  }

  generate(req: GenerateRequest): Promise<ProviderImage> {
    this.requests.push(req)
    return Promise.resolve(this.#image(req))
  }

  edit(req: EditRequest): Promise<ProviderImage> {
    this.requests.push(req)
    return Promise.resolve(this.#image(req))
  }

  #image(req: GenerateRequest): ProviderImage {
    return {
      bytes: new TextEncoder().encode(this.id),
      mimeType: 'image/png',
      model: req.model ?? this.defaultModel,
      meta: {},
    }
  }
}

interface HarnessOptions {
  /** Умеет ли редактировать активный провайдер. */
  activeEdits?: boolean
  presets?: readonly Preset[]
}

function harness(options: HarnessOptions = {}) {
  const storage = new InMemoryFileStorage()
  const presets = new InMemoryPresetRepository(options.presets ?? [])
  const active = new SigningProvider('openai', ['gpt-image-2'], {
    edit: options.activeEdits ?? true,
  })
  const fake = new SigningProvider('fake', ['fake-image-1'])

  const providers: ProviderSelector = {
    forModel: (model) =>
      [active, fake].find((provider) => provider.models.some((entry) => entry.id === model)) ??
      active,
  }

  return {
    active,
    fake,
    /** Кто исполнил ноду — по подписи в сохранённых байтах. */
    run: async (node: WorkflowNode, inputs: ResolvedInputs = PROMPT_INPUT): Promise<string> => {
      const output = await executeNode(
        { providers, storage, presets },
        node,
        inputs,
        { runId: 'run-1', jobId: 'job-1', nodeId: node.id },
        new AbortController().signal,
      )
      if (output.type !== 'image') throw new Error('ожидалось изображение')
      return new TextDecoder().decode((await storage.get(output.fileId)).bytes)
    },
  }
}

/** Нода нужного вида: значения по умолчанию проставляет схема графа. */
function node(kind: 'generateImage' | 'editImage', data: Record<string, unknown>): WorkflowNode {
  const graph = workflowGraphSchema.parse({
    nodes: [{ id: 'n', kind, position: { x: 0, y: 0 }, data }],
    edges: [],
  })
  const parsed = graph.nodes[0]
  if (!parsed) throw new Error('нода не разобралась')
  return parsed
}

function preset(defaults: Preset['defaults']): Preset {
  const now = new Date().toISOString()
  return {
    id: 'preset-1',
    name: 'Пресет',
    mainPrompt: 'студийный свет',
    negativePrompt: null,
    references: [],
    defaults,
    createdAt: now,
    updatedAt: now,
  }
}

const PROMPT_INPUT: ResolvedInputs = { prompt: { type: 'text', value: 'кружка на бетоне' } }

const IMAGE_INPUT: ResolvedInputs = {
  image: { type: 'image', fileId: 'file-1' },
  instruction: { type: 'text', value: 'сделай фон светлее' },
}

it('исполняет ноду тем провайдером, которому принадлежит выбранная модель', async () => {
  const test = harness()

  await expect(test.run(node('generateImage', { model: 'fake-image-1' }))).resolves.toBe('fake')
})

it('нода без модели уходит активному провайдеру', async () => {
  const test = harness()

  await expect(test.run(node('generateImage', { model: null }))).resolves.toBe('openai')
})

it('неизвестная модель уходит активному провайдеру, а не молча в заглушку', async () => {
  const test = harness()

  await expect(test.run(node('generateImage', { model: 'gemini-3.1-flash-image' }))).resolves.toBe(
    'openai',
  )
})

it('модель пресета выбирает провайдера так же, как модель ноды', async () => {
  const test = harness({ presets: [preset({ model: 'fake-image-1' })] })

  await expect(test.run(node('generateImage', { presetId: 'preset-1' }))).resolves.toBe('fake')
})

it('редактирование проверяет возможности выбранного провайдера, а не активного', async () => {
  const test = harness({ activeEdits: false })

  await expect(test.run(node('editImage', { model: 'fake-image-1' }), IMAGE_INPUT)).resolves.toBe(
    'fake',
  )
})

it('запрос уходит только выбранному провайдеру', async () => {
  const test = harness()

  await test.run(node('generateImage', { model: 'fake-image-1', aspectRatio: '16:9' }))

  expect(test.active.requests).toHaveLength(0)
  expect(test.fake.requests[0]?.model).toBe('fake-image-1')
})
