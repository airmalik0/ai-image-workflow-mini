import type { JobStatus } from '@workflow/contracts'
import { cn } from '../../lib'
import { StatusGlyph } from '../icon'
import styles from './status-pill.module.css'

/** Подписи статусов. Набор статусов приходит из @workflow/contracts, свой не заводим. */
export const STATUS_LABELS: Record<JobStatus, string> = {
  idle: 'Ожидает',
  queued: 'В очереди',
  running: 'Выполняется',
  success: 'Готово',
  error: 'Ошибка',
  skipped: 'Пропущено',
}

export interface StatusPillProps {
  status: JobStatus
  size?: 'sm' | 'md' | undefined
  /** Замена подписи — например, длительность вместо названия статуса. */
  label?: string | undefined
  className?: string | undefined
}

export const StatusPill = ({ status, size = 'md', label, className }: StatusPillProps) => (
  <span className={cn(styles.pill, styles[status], styles[size], className)}>
    <StatusGlyph status={status} className={styles.glyph} />
    {label ?? STATUS_LABELS[status]}
  </span>
)
