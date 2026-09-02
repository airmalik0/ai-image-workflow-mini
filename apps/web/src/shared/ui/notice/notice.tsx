import type { ReactNode } from 'react'
import { cn } from '../../lib'
import styles from './notice.module.css'

export type NoticeTone = 'error' | 'warning' | 'info'

export interface NoticeProps {
  title: ReactNode
  tone?: NoticeTone | undefined
  /**
   * Машиночитаемый код отказа. Показывается рядом с текстом: «что-то пошло не так»
   * нельзя ни загуглить, ни найти в логах, а `PROVIDER_SAFETY_BLOCKED` — можно.
   */
  code?: string | undefined
  hint?: ReactNode | undefined
  actions?: ReactNode | undefined
  children?: ReactNode
  className?: string | undefined
}

/**
 * Сообщение об отказе. Ошибка объявляется голосом ассистивных технологий сразу
 * (`role="alert"`), предупреждение и справка — не перебивая пользователя.
 */
export const Notice = ({
  title,
  tone = 'error',
  code,
  hint,
  actions,
  children,
  className,
}: NoticeProps) => (
  <div
    className={cn(styles.notice, styles[tone], className)}
    role={tone === 'error' ? 'alert' : 'status'}
  >
    <span className={styles.mark} aria-hidden="true" />
    <div className={styles.content}>
      <span className={styles.head}>
        <span className={styles.title}>{title}</span>
        {code !== undefined && <code className={styles.code}>{code}</code>}
      </span>
      {children !== undefined && <p className={styles.text}>{children}</p>}
      {hint !== undefined && <p className={styles.hint}>{hint}</p>}
    </div>
    {actions !== undefined && <div className={styles.actions}>{actions}</div>}
  </div>
)
