import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib'
import { Spinner } from '../icon'
import styles from './button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  /** Показывает индикатор и блокирует повторное нажатие. */
  loading?: boolean | undefined
  icon?: ReactNode | undefined
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={cn(styles.button, styles[variant], styles[size], className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {(loading || icon) && <span className={styles.slot}>{loading ? <Spinner /> : icon}</span>}
    {children !== undefined && <span className={styles.label}>{children}</span>}
  </button>
)
