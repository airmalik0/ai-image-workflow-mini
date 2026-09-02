import { cn } from '@/shared/lib'
import { Chip } from '@/shared/ui'
import styles from './param-chips.module.css'

export interface ChipOption {
  /** `null` — «не выбрано»: пресета нет, модель по умолчанию. */
  value: string | null
  label: string
  /** Возможность, которой у модели нет: выбрать нельзя, но видно, что она есть. */
  disabled?: boolean | undefined
  title?: string | undefined
  marked?: boolean | undefined
}

export interface ParamChipsProps {
  label: string
  options: readonly ChipOption[]
  value: string | null
  onSelect: (value: string | null) => void
  /** Текст вместо чипов, когда выбирать не из чего. */
  empty?: string | undefined
  /** Внутри карточки ноды: мельче, подпись — микрокеглем. */
  compact?: boolean | undefined
  className?: string | undefined
}

/**
 * Ряд чипов для параметра-перечисления. Один и тот же ряд стоит и в карточке ноды,
 * и в инспекторе — переключение модели не должно выглядеть двумя разными контролами
 * в зависимости от того, откуда на него смотрят.
 *
 * `nodrag` обязателен: без него нажатие на чип внутри ноды React Flow принимает
 * за начало перетаскивания карточки.
 */
export const ParamChips = ({
  label,
  options,
  value,
  onSelect,
  empty,
  compact = false,
  className,
}: ParamChipsProps) => (
  <div className={cn(styles.row, compact && styles.compact, 'nodrag', className)}>
    <span className={cn(styles.label, compact && styles.labelCompact)}>{label}</span>
    {options.length === 0 ? (
      <span className={styles.empty}>{empty ?? 'нет вариантов'}</span>
    ) : (
      <span className={styles.chips} role="group" aria-label={label}>
        {options.map((option) => (
          <Chip
            key={option.value ?? '—'}
            selected={option.value === value}
            disabled={option.disabled}
            marked={option.marked}
            title={option.title}
            onClick={() => onSelect(option.value)}
            className={styles.chip}
          >
            {option.label}
          </Chip>
        ))}
      </span>
    )}
  </div>
)
