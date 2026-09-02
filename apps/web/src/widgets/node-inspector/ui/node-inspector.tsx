import type { NodeKind } from '@workflow/contracts'
import {
  ASPECT_RATIOS,
  NODE_DESCRIPTIONS,
  NODE_LABELS,
  PARAM_HINTS,
  PARAM_LABELS,
  ParamChips,
  PortSignature,
  nodeParamFields,
  paramValue,
} from '@/entities/node'
import type { ParamFieldSpec } from '@/entities/node'
import { findPreset, usePresets } from '@/entities/preset'
import { useWorkflowStore } from '@/entities/workflow'
import type { WorkflowFlowNode } from '@/entities/workflow'
import {
  ModelPicker,
  capabilityFallback,
  findModel,
  supportsCapability,
  useModels,
} from '@/features/select-model'
import { PresetPicker } from '@/features/select-preset'
import { ImageUploader } from '@/features/upload-image'
import { Field } from '@/shared/ui'
import styles from './node-inspector.module.css'

/** Длина, начиная с которой поле рисуется многострочным. Берётся из схемы, а не из имени поля. */
const MULTILINE_THRESHOLD = 200

type Patch = Record<string, unknown>

interface ControlProps {
  node: WorkflowFlowNode
  field: ParamFieldSpec
  value: string | null
  onChange: (patch: Patch) => void
}

const label = (name: string) => PARAM_LABELS[name] ?? name

/**
 * Сводка выбранного пресета. Здесь же гасится negative prompt: у выбранной модели
 * такого поля нет, и показать это надо явно — иначе интерфейс молча теряет то,
 * что пользователь считает настройкой.
 */
const PresetSummary = ({
  presetId,
  modelId,
}: {
  presetId: string | null
  modelId: string | null
}) => {
  const { presets } = usePresets()
  const { models } = useModels()
  const preset = findPreset(presets, presetId)
  if (preset === null) return null

  const model = findModel(models, modelId)
  const negativeSupported = supportsCapability(model, 'negativePrompt')

  return (
    <div className={styles.summary}>
      <span className={styles.summaryTitle}>Пресет «{preset.name}»</span>
      <p className={styles.summaryText}>{preset.mainPrompt}</p>

      <Field
        label="Negative prompt пресета"
        value={preset.negativePrompt ?? ''}
        onChange={() => undefined}
        multiline
        rows={2}
        disabled={!negativeSupported}
        placeholder="в пресете не задан"
        hint={negativeSupported ? undefined : capabilityFallback('negativePrompt')}
      />

      <span className={styles.summaryMeta}>референсов в пресете: {preset.references.length}</span>
    </div>
  )
}

/**
 * Контрол параметра. Список полей приходит из `NODE_SPECS`, а этот разбор отвечает
 * только на вопрос «чем рисовать»: параметр, для которого специального контрола нет,
 * получает обычное текстовое поле и в форме не пропадает.
 */
const ParamControl = ({ node, field, value, onChange }: ControlProps) => {
  switch (field.name) {
    case 'model':
      return (
        <ModelPicker
          label={label(field.name)}
          value={value}
          onChange={(model) => onChange({ model })}
          // Модель без поддержки edit сделает ноду редактирования неработающей.
          {...(node.type === 'editImage' ? { requires: 'edit' as const } : {})}
        />
      )

    case 'presetId':
      return (
        <>
          <PresetPicker
            label={label(field.name)}
            value={value}
            onChange={(presetId) => onChange({ presetId })}
          />
          <PresetSummary presetId={value} modelId={paramValue(node.data, 'model')} />
        </>
      )

    case 'fileId':
      return (
        <ImageUploader
          label={label(field.name)}
          value={value}
          onChange={(fileId) => onChange({ fileId })}
        />
      )

    case 'aspectRatio':
      return (
        <ParamChips
          label={label(field.name)}
          value={value}
          onSelect={(aspectRatio) => onChange({ aspectRatio: aspectRatio ?? field.defaultValue })}
          options={ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
        />
      )

    default:
      return (
        <Field
          label={label(field.name)}
          value={value ?? ''}
          onChange={(next) => onChange({ [field.name]: next })}
          multiline={field.maxLength !== null && field.maxLength >= MULTILINE_THRESHOLD}
          rows={6}
          {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
          {...(PARAM_HINTS[field.name] === undefined ? {} : { hint: PARAM_HINTS[field.name] })}
          placeholder={field.defaultValue === '' ? 'пусто' : undefined}
        />
      )
  }
}

const NodeForm = ({ node }: { node: WorkflowFlowNode }) => {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const fields = nodeParamFields(node.type)

  if (fields.length === 0) {
    return (
      <p className={styles.note}>
        У ноды «{NODE_LABELS[node.type]}» нет параметров: всё, что ей нужно, приходит по связям.
      </p>
    )
  }

  return (
    <div className={styles.form}>
      {fields.map((field) => (
        <div key={field.name} className={styles.field} data-param={field.name}>
          <ParamControl
            node={node}
            field={field}
            value={paramValue(node.data, field.name)}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        </div>
      ))}
    </div>
  )
}

const Header = ({ kind, id }: { kind: NodeKind; id: string }) => (
  <header className={styles.header}>
    <div className={styles.heading}>
      <span className={styles.kind}>{NODE_LABELS[kind]}</span>
      <span className={styles.id}>{id}</span>
    </div>
    <PortSignature kind={kind} />
  </header>
)

/**
 * Инспектор ноды. Форма собирается из `NODE_SPECS[kind].params` — второго списка
 * полей на фронте нет: параметр, добавленный в контракт, появляется здесь сам,
 * а забытый в контракте не появится вовсе.
 *
 * Источник правды о выделении — сами ноды: React Flow держит `selected` на них.
 */
export const NodeInspector = () => {
  const nodes = useWorkflowStore((state) => state.nodes)
  const selected = nodes.filter((node) => node.selected === true)
  const node = selected.length === 1 ? selected[0] : undefined

  return (
    <aside className={styles.inspector} aria-label="Инспектор ноды">
      {node === undefined ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>
            {selected.length === 0 ? 'Нода не выбрана' : `Выделено нод: ${selected.length}`}
          </span>
          <p className={styles.emptyText}>
            {selected.length === 0
              ? 'Нажмите на ноду на холсте — здесь появятся её параметры.'
              : 'Параметры правятся по одной ноде: оставьте выделенной одну.'}
          </p>
        </div>
      ) : (
        <>
          <Header kind={node.type} id={node.id} />
          <p className={styles.description}>{NODE_DESCRIPTIONS[node.type]}</p>
          <div className={styles.scroll}>
            <NodeForm node={node} />
          </div>
        </>
      )}
    </aside>
  )
}
