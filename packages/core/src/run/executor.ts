import type { JobOutput, WorkflowNode } from '@workflow/contracts'
import { DomainError } from '../errors.js'
import type { FileStorage } from '../ports/file-storage.js'
import type { ImageProvider, ImageRef, RequestOrigin } from '../ports/image-provider.js'
import type { ResolvedInputs } from '../ports/job-dispatcher.js'
import type { PresetLookup } from '../ports/repositories.js'
import { buildEditRequest, buildProviderRequest } from '../preset/request-builder.js'

export interface ExecutionDeps {
  provider: ImageProvider
  storage: FileStorage
  presets: PresetLookup
}

/**
 * Исполнение одной ноды. Функция ничего не знает о графе и о соседях: ей дают
 * ноду, уже разрешённые входы и сигнал отмены — этого достаточно. Благодаря
 * этому воркер можно масштабировать репликами, а тесты ядра гонять без очереди.
 *
 * Ошибки наружу уходят как есть: тихая подмена результата заглушкой запрещена,
 * упавший job обязан оставаться упавшим и предлагать Retry.
 */
export async function executeNode(
  deps: ExecutionDeps,
  node: WorkflowNode,
  inputs: ResolvedInputs,
  origin: RequestOrigin,
  signal: AbortSignal,
): Promise<JobOutput> {
  switch (node.kind) {
    case 'prompt':
      return { type: 'text', value: node.data.text }

    case 'imageInput': {
      const fileId = node.data.fileId
      if (!fileId) throw invalid(node.id, 'изображение не загружено')
      return { type: 'image', fileId }
    }

    case 'generateImage': {
      const request = buildProviderRequest({
        userPrompt: requireText(inputs, 'prompt', node.id),
        preset: await loadPreset(deps, node.data.presetId, node.id),
        params: node.data,
        capabilities: deps.provider.capabilities,
        origin,
      })
      const image = await deps.provider.generate(request, signal)
      return { type: 'image', fileId: await deps.storage.put(image.bytes, image.mimeType) }
    }

    case 'editImage': {
      if (!deps.provider.capabilities.edit) {
        throw invalid(node.id, `провайдер «${deps.provider.id}» не умеет редактировать изображения`)
      }
      const request = buildEditRequest({
        // текст со входа важнее поля ноды: соединённый порт — более явное намерение
        userPrompt: optionalText(inputs, 'instruction') ?? node.data.instruction,
        preset: await loadPreset(deps, node.data.presetId, node.id),
        params: node.data,
        capabilities: deps.provider.capabilities,
        image: requireImage(inputs, 'image', node.id),
        origin,
      })
      const image = await deps.provider.edit(request, signal)
      return { type: 'image', fileId: await deps.storage.put(image.bytes, image.mimeType) }
    }

    case 'result':
      // терминал ничего не считает: он показывает результат предшественника
      return { type: 'image', fileId: requireImage(inputs, 'image', node.id).fileId }
  }
}

async function loadPreset(
  deps: ExecutionDeps,
  presetId: string | null,
  nodeId: string,
): Promise<Awaited<ReturnType<PresetLookup['findById']>>> {
  if (!presetId) return null
  const preset = await deps.presets.findById(presetId)
  // молча сгенерировать без пресета — значит отдать не ту картинку, которую просили
  if (!preset) throw invalid(nodeId, `пресет «${presetId}» не найден`)
  return preset
}

function requireText(inputs: ResolvedInputs, port: string, nodeId: string): string {
  const value = optionalText(inputs, port)
  if (value === null) throw invalid(nodeId, `на входе «${port}» нет текста`)
  return value
}

function optionalText(inputs: ResolvedInputs, port: string): string | null {
  const input = inputs[port]
  return input && input.type === 'text' ? input.value : null
}

function requireImage(inputs: ResolvedInputs, port: string, nodeId: string): ImageRef {
  const input = inputs[port]
  if (!input || input.type !== 'image') throw invalid(nodeId, `на входе «${port}» нет изображения`)
  return { fileId: input.fileId }
}

function invalid(nodeId: string, message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', `Нода «${nodeId}»: ${message}`)
}
