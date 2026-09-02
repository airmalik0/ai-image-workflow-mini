import type { NodeDataOf } from '@workflow/contracts'
import type { Node, NodeProps } from '@xyflow/react'
import { cn } from '@/shared/lib'
import { useNodeControls, useNodeRun } from '../model/node-controls'
import { NodeImage } from './node-image'
import { NodeShell } from './node-shell'
import { ParamChips } from './param-chips'
import styles from './node.module.css'

export type GenerateImageFlowNode = Node<NodeDataOf<'generateImage'>, 'generateImage'>

/** Значение параметра или курсивная заглушка: пустая нода должна читаться так же ясно. */
const Tag = ({ label, value }: { label: string; value: string | null }) => (
  <span className={styles.tag}>
    <span className={styles.tagKey}>{label}</span>
    <span className={cn(value === null && styles.tagEmpty)}>{value ?? 'по умолчанию'}</span>
  </span>
)

/**
 * Панель генерации. Модель и пресет переключаются прямо здесь: это главные ручки
 * ноды, и уводить их в боковую панель — значит заставлять целиться в инспектор
 * ради одного чипа. Промпт при переключении остаётся: он приходит по связи из
 * ноды `prompt` и параметром генерации не является.
 */
export const GenerateImageNode = ({ id, data, selected }: NodeProps<GenerateImageFlowNode>) => {
  const controls = useNodeControls()
  const run = useNodeRun(id)

  return (
    <NodeShell
      kind="generateImage"
      id={id}
      selected={selected === true}
      className={controls === null ? undefined : styles.wide}
    >
      {run.imageFileId === null ? (
        <div className={styles.frame}>
          {run.status === 'running'
            ? 'Генерируем изображение…'
            : 'Изображение появится после запуска'}
        </div>
      ) : (
        <NodeImage fileId={run.imageFileId} title={`Генерация ${id}`} />
      )}

      {controls === null ? (
        <div className={styles.tags}>
          <Tag label="модель" value={data.model} />
          <Tag label="пресет" value={data.presetId} />
          <Tag label="кадр" value={data.aspectRatio} />
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
                title: `Провайдер ${model.providerId}`,
                marked: model.supportsEdit,
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
          <div className={styles.tags}>
            <Tag label="кадр" value={data.aspectRatio} />
          </div>
        </>
      )}
    </NodeShell>
  )
}
