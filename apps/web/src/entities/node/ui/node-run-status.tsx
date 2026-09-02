import { describeApiError, describeJobError } from '@/shared/api'
import { cn } from '@/shared/lib'
import { Button } from '@/shared/ui'
import type { NodeRunView } from '../model/node-controls'
import styles from './node.module.css'

/** Что делать, когда провайдер пометил ошибку неповторяемой, а своей подсказки нет. */
const NOT_RETRYABLE_HINT =
  'Повтор даст тот же результат: причина не в сбое, а в самом запросе или доступе'

const RETRYABLE_HINT = 'Ошибка помечена как повторяемая — повтор имеет смысл'

/**
 * Отказ ноды прямо на карточке: код, текст провайдера и повтор.
 *
 * Код показывается рядом с текстом не для красоты — «что-то пошло не так» нельзя
 * ни найти в логах, ни соотнести с поведением, а `PROVIDER_SAFETY_BLOCKED` можно.
 * Кнопка повтора у неповторяемой ошибки не исчезает, но и не предлагается вслепую:
 * рядом сказано, что повтор сам по себе ничего не изменит.
 */
export const NodeRunStatus = ({ run }: { run: NodeRunView }) => {
  const job = run.job
  if (job === null || job.status !== 'error' || job.error === null) return null

  const described = describeJobError(job.error)
  const retryable = described.retryable === true
  const rejection = run.retryError === null ? null : describeApiError(run.retryError)

  return (
    <div className={cn(styles.failure, 'nodrag')}>
      <span className={styles.failureHead}>
        <span className={styles.failureTitle}>{described.title}</span>
        <code className={styles.failureCode}>{described.code}</code>
      </span>

      <p className={styles.failureText}>{described.message}</p>
      <p className={styles.failureHint}>
        {described.hint ?? (retryable ? RETRYABLE_HINT : NOT_RETRYABLE_HINT)}
      </p>

      {run.retry !== null && (
        <Button
          size="sm"
          variant={retryable ? 'primary' : 'ghost'}
          loading={run.isRetrying}
          onClick={run.retry}
          title={
            retryable
              ? 'Повторить ноду и всё, что от неё зависит'
              : 'Повтор запустит ноду заново с тем же запросом'
          }
        >
          {retryable ? 'Повторить' : 'Повторить всё равно'}
        </Button>
      )}

      {rejection !== null && (
        <p className={styles.failureText}>
          Повтор не принят: {rejection.message}{' '}
          <code className={styles.failureCode}>{rejection.code}</code>
        </p>
      )}
    </div>
  )
}
