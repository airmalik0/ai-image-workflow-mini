import { ParamChips } from '@/entities/node'
import type { ChipOption } from '@/entities/node'
import { cn } from '@/shared/lib'
import { StatusGlyph } from '@/shared/ui'
import { MODEL_CAPABILITIES } from '../lib/capabilities'
import type { CapabilityId } from '../lib/capabilities'
import { findModel, useModels } from '../model/use-models'
import styles from './model-picker.module.css'

export interface ModelPickerProps {
  label: string
  value: string | null
  onChange: (model: string | null) => void
  /** Возможность, без которой модель для этой ноды бесполезна: такие чипы гасятся. */
  requires?: CapabilityId | undefined
}

/**
 * Выбор модели с матрицей возможностей. Список приходит из `GET /api/models`:
 * какие модели доступны, решает сервер по заданным ключам провайдеров, а не фронт.
 */
export const ModelPicker = ({ label, value, onChange, requires }: ModelPickerProps) => {
  const { models, isLoading, error } = useModels()
  const selected = findModel(models, value)

  const options: ChipOption[] = [
    { value: null, label: 'по умолчанию', title: 'Провайдер возьмёт свою модель' },
    ...models.map((model) => {
      const capability = MODEL_CAPABILITIES.find((item) => item.id === requires)
      const blocked = capability !== undefined && !capability.supported(model)
      return {
        value: model.id,
        label: model.label,
        disabled: blocked,
        title: blocked
          ? `${model.label}: ${capability.label.toLowerCase()} не поддерживается`
          : `Провайдер ${model.providerId}`,
      }
    }),
  ]

  return (
    <div className={styles.picker}>
      <ParamChips
        label={label}
        value={value}
        options={options}
        onSelect={onChange}
        empty={isLoading ? 'загружаем список моделей…' : 'список моделей недоступен'}
      />

      {error !== null && (
        <p className={styles.error}>
          <StatusGlyph status="error" /> Модели не загрузились: {error.message}
        </p>
      )}

      {selected === null ? (
        <p className={styles.pending}>
          Модель не выбрана — провайдер возьмёт свою, и набор возможностей определит он.
        </p>
      ) : (
        <ul className={styles.capabilities}>
          {MODEL_CAPABILITIES.map((capability) => {
            const supported = capability.supported(selected)
            return (
              <li key={capability.id} className={cn(styles.capability, !supported && styles.off)}>
                <StatusGlyph
                  status={supported ? 'success' : 'skipped'}
                  className={styles.capabilityGlyph}
                />
                <span className={styles.capabilityBody}>
                  <span className={styles.capabilityLabel}>{capability.label}</span>
                  {!supported && (
                    <span className={styles.capabilityNote}>{capability.fallback}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
