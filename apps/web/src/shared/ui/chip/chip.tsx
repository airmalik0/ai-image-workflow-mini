import type { ReactNode } from 'react'
import { cn } from '../../lib'
import styles from './chip.module.css'

export interface ChipProps {
  children: ReactNode
  selected?: boolean | undefined
  disabled?: boolean | undefined
  icon?: ReactNode | undefined
  /** Точка слева — например, признак «модель умеет редактирование». */
  marked?: boolean | undefined
  onClick?: (() => void) | undefined
  title?: string | undefined
  className?: string | undefined
}

export const Chip = ({
  children,
  selected = false,
  disabled = false,
  icon,
  marked = false,
  onClick,
  title,
  className,
}: ChipProps) => (
  <button
    type="button"
    className={cn(styles.chip, selected && styles.selected, className)}
    aria-pressed={selected}
    disabled={disabled}
    onClick={onClick}
    title={title}
  >
    {marked && <span className={styles.mark} aria-hidden="true" />}
    {icon && <span className={styles.icon}>{icon}</span>}
    {children}
  </button>
)
