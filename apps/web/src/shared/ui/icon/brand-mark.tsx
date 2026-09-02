import { cn } from '../../lib'
import styles from './icon.module.css'

/**
 * Знак приложения: два порта и провод между ними — то, из чего состоит граф.
 * Провод — единственное место в шапке, где появляется акцентный цвет.
 */
export const BrandMark = ({ className }: { className?: string | undefined }) => (
  <svg className={cn(styles.brand, className)} viewBox="0 0 20 20" aria-hidden="true">
    <path className={styles.brandWire} d="M6.4 6.2c3.4 0 3.4 7.6 6.8 7.6" />
    <circle className={styles.brandPort} cx="4.2" cy="6.2" r="2.2" />
    <circle className={styles.brandPort} cx="15.4" cy="13.8" r="2.2" />
  </svg>
)
