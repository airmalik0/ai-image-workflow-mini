import type { NodeKind } from '@workflow/contracts'
import type { NodeTypes } from '@xyflow/react'
import { EditImageNode } from './edit-image-node'
import { GenerateImageNode } from './generate-image-node'
import { ImageInputNode } from './image-input-node'
import { PromptNode } from './prompt-node'
import { ResultNode } from './result-node'

/**
 * Реестр рендереров: ключ — `kind` из контрактов, значение — компонент.
 * `Record<NodeKind, …>` не даст завести тип ноды и забыть про её отрисовку.
 * Константа модульного уровня — React Flow пересобирает канвас при смене ссылки.
 */
export const workflowNodeTypes: Record<NodeKind, NodeTypes[string]> = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  generateImage: GenerateImageNode,
  editImage: EditImageNode,
  result: ResultNode,
}
