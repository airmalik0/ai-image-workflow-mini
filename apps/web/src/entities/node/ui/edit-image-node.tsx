import type { NodeDataOf } from '@workflow/contracts'
import type { Node, NodeProps } from '@xyflow/react'
import { cn } from '@/shared/lib'
import { useNodeControls, useNodeRun } from '../model/node-controls'
import { NodeImage } from './node-image'
import { NodeShell } from './node-shell'
import { ParamChips } from './param-chips'
import styles from './node.module.css'

export type EditImageFlowNode = Node<NodeDataOf<'editImage'>, 'editImage'>

/**
 * Редактирование изображения. Модель здесь не косметика: часть моделей вовсе не
 * умеет edit, и такие чипы гасятся — выбрать модель, которая не сделает работу,
 * нельзя, а увидеть, что она есть и почему недоступна, нужно.
 */
export const EditImageNode = ({ id, data, selected }: NodeProps<EditImageFlowNode>) => {
  const controls = useNodeControls()
  const run = useNodeRun(id)

  return (
    <NodeShell
      kind="editImage"
      id={id}
      selected={selected === true}
      className={controls === null ? undefined : styles.wide}
    >
      <p className={cn(styles.text, data.instruction === '' && styles.placeholder)}>
        {data.instruction === '' ? 'Инструкция не задана' : data.instruction}
      </p>

      {run.imageFileId !== null && (
        <NodeImage fileId={run.imageFileId} title={`Редактирование ${id}`} />
      )}

      {controls === null ? (
        <div className={styles.tags}>
          <span className={styles.tag}>
            <span className={styles.tagKey}>модель</span>
            <span className={cn(data.model === null && styles.tagEmpty)}>
              {data.model ?? 'по умолчанию'}
            </span>
          </span>
          <span className={styles.tag}>
            <span className={styles.tagKey}>пресет</span>
            <span className={cn(data.presetId === null && styles.tagEmpty)}>
              {data.presetId ?? 'по умолчанию'}
            </span>
          </span>
        </div>
      ) : (
        <>
          <ParamChips
            compact
            label="Модель"
            value={data.model}
            empty="модели не загружены"
            onSelect={(model) => controls.updateNodeData(id, { model })}
            options={[
              { value: null, label: 'по умолчанию' },
              ...controls.models.map((model) => ({
                value: model.id,
                label: model.label,
                disabled: !model.supportsEdit,
                title: model.supportsEdit
                  ? `Провайдер ${model.providerId}`
                  : `${model.label} не умеет редактировать изображение`,
              })),
            ]}
          />
          <ParamChips
            compact
            label="Пресет"
            value={data.presetId}
            empty="пресеты не загружены"
            onSelect={(presetId) => controls.updateNodeData(id, { presetId })}
            options={[
              { value: null, label: 'без пресета' },
              ...controls.presets.map((preset) => ({ value: preset.id, label: preset.name })),
            ]}
          />
        </>
      )}
    </NodeShell>
  )
}
