import type { ReactNode } from 'react'
import { cn } from '../../lib'
import styles from './panel.module.css'

export interface PanelProps {
  children: ReactNode
  title?: ReactNode | undefined
  description?: ReactNode | undefined
  actions?: ReactNode | undefined
  footer?: ReactNode | undefined
  /** `none` — для содержимого, которое само отвечает за поля: канвас, список, таблица. */
  padding?: 'default' | 'none' | undefined
  className?: string | undefined
}

export const Panel = ({
  children,
  title,
  description,
  actions,
  footer,
  padding = 'default',
  className,
}: PanelProps) => (
  <section className={cn(styles.panel, className)}>
    {(title !== undefined || actions !== undefined) && (
      <header className={styles.head}>
        <div className={styles.heading}>
          {title !== undefined && <h3 className={styles.title}>{title}</h3>}
          {description !== undefined && <p className={styles.description}>{description}</p>}
        </div>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </header>
    )}
    <div className={cn(styles.body, padding === 'default' && styles.padded)}>{children}</div>
    {footer !== undefined && <div className={styles.footer}>{footer}</div>}
  </section>
)
