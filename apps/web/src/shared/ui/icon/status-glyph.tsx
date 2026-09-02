import type { JobStatus } from '@workflow/contracts'
import type { ReactNode } from 'react'
import { cn } from '../../lib'
import styles from './icon.module.css'

/**
 * Форма глифа несёт статус наравне с цветом: интерфейс остаётся читаемым
 * и при цветовой слепоте, и на чёрно-белой распечатке.
 */
const SHAPES: Record<JobStatus, ReactNode> = {
  idle: <circle cx="8" cy="8" r="5.25" />,
  queued: (
    <>
      <circle cx="4.25" cy="8" r="0.9" fill="currentcolor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentcolor" stroke="none" />
      <circle cx="11.75" cy="8" r="0.9" fill="currentcolor" stroke="none" />
    </>
  ),
  running: (
    <>
      <circle className={styles.spinnerTrack} cx="8" cy="8" r="5.25" />
      <path className={styles.spinnerArc} d="M8 2.75a5.25 5.25 0 0 1 5.25 5.25" />
    </>
  ),
  success: <path d="m3.75 8.4 2.9 2.9 5.6-6.1" />,
  error: (
    <>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M8 5.1v3.5" />
      <circle cx="8" cy="10.9" r="0.75" fill="currentcolor" stroke="none" />
    </>
  ),
  skipped: (
    <>
      <circle className={styles.dashedRing} cx="8" cy="8" r="5.25" />
      <path d="M5.5 10.5 10.5 5.5" />
    </>
  ),
}

export const StatusGlyph = ({
  status,
  className,
}: {
  status: JobStatus
  className?: string | undefined
}) => (
  <svg className={cn(styles.icon, className)} viewBox="0 0 16 16" aria-hidden="true">
    {SHAPES[status]}
  </svg>
)
