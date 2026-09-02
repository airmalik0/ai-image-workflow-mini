import { cn } from '../../lib'
import styles from './icon.module.css'

/** Дуга-индикатор. Тот же мотив, что у статуса `running`, — вращение читается как «идёт». */
export const Spinner = ({ className }: { className?: string | undefined }) => (
  <svg className={cn(styles.icon, className)} viewBox="0 0 16 16" aria-hidden="true">
    <circle className={styles.spinnerTrack} cx="8" cy="8" r="5.25" />
    <path className={styles.spinnerArc} d="M8 2.75a5.25 5.25 0 0 1 5.25 5.25" />
  </svg>
)
