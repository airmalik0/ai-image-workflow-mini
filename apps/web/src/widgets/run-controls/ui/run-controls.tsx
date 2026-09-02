import { useId, useState } from 'react'
import {
  isRunActive,
  runProgress,
  RUN_STATUS_LABELS,
  useActiveRun,
  useRunState,
} from '@/entities/run'
import { useCancelRun } from '@/features/cancel-run'
import { useRunWorkflow } from '@/features/run-workflow'
import { describeApiError } from '@/shared/api'
import { cn } from '@/shared/lib'
import { Button, Notice } from '@/shared/ui'
import styles from './run-controls.module.css'

/**
 * Пульт запуска в шапке редактора: запустить, отменить, увидеть, чем кончилось.
 *
 * Состояние берётся из того же кэша, что правит поток событий, поэтому кнопки
 * меняются в такт нодам, а не по собственному таймеру. Второй запуск, пока идёт
 * первый, не даётся: он бы бросил предыдущий догорать у провайдера, потеряв
 * всякое представление в интерфейсе — сначала отмена, потом новый запуск.
 */
export const RunControls = () => {
  const runId = useActiveRun((state) => state.runId)
  const { state } = useRunState(runId)
  const run = useRunWorkflow()
  const cancel = useCancelRun()
  const [open, setOpen] = useState(true)

  const panelId = useId()
  const status = state?.run.status ?? null
  const active = status !== null && isRunActive(status)
  const progress = runProgress(state)
  const failure = run.error === null ? null : describeApiError(run.error)
  const cancelFailure = cancel.error === null ? null : describeApiError(cancel.error)
  const problems = run.issues.length > 0 || failure !== null || cancelFailure !== null

  return (
    <div className={styles.controls}>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setOpen(true)
          run.start()
        }}
        loading={run.isStarting}
        disabled={active}
        title={
          active
            ? 'Запуск уже идёт: дождитесь конца или отмените его'
            : 'Проверить граф и запустить'
        }
      >
        Запустить
      </Button>

      {active && cancel.cancel !== null && (
        <Button variant="secondary" size="sm" onClick={cancel.cancel} loading={cancel.isCancelling}>
          Отменить
        </Button>
      )}

      {status !== null && (
        <span className={styles.state} data-run-status={status}>
          <span className={cn(styles.mark, styles[status])} aria-hidden="true" />
          <span className={styles.stateText}>запуск {RUN_STATUS_LABELS[status]}</span>
          {progress.total > 0 && (
            <span className={styles.progress}>
              {progress.done}/{progress.total}
              {progress.failed > 0 && (
                <span className={styles.failedCount}> · {progress.failed} с ошибкой</span>
              )}
            </span>
          )}
        </span>
      )}

      {problems && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
        >
          {open ? 'скрыть причину' : 'почему не запустилось'}
        </button>
      )}

      {problems && open && (
        <div
          className={styles.panel}
          id={panelId}
          role="region"
          aria-label="Почему запуск не состоялся"
        >
          {run.issues.length > 0 && (
            <>
              <Notice
                title="Граф не запущен: он не прошёл проверку"
                code="GRAPH_INVALID"
                hint="Виновники выделены на холсте. Исправьте их и запустите снова"
                actions={
                  <Button size="sm" variant="ghost" onClick={run.dismiss}>
                    Понятно
                  </Button>
                }
              >
                {run.issues.length === 1 ? 'Причина одна:' : `Причин: ${run.issues.length}`}
              </Notice>
              {/* список вынесен из Notice: его текст — абзац, а <ul> внутри <p> невалиден */}
              <ul className={styles.issues}>
                {run.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className={styles.issue}>
                    <span>{issue.message}</span>
                    <code className={styles.issueCode}>{issue.code}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {failure !== null && (
            <Notice
              title={failure.title}
              code={failure.code}
              {...(failure.hint === null ? {} : { hint: failure.hint })}
            >
              {failure.message}
            </Notice>
          )}

          {cancelFailure !== null && (
            <Notice
              title={`Отмена не удалась: ${cancelFailure.title}`}
              code={cancelFailure.code}
              {...(cancelFailure.hint === null ? {} : { hint: cancelFailure.hint })}
            >
              {cancelFailure.message}
            </Notice>
          )}
        </div>
      )}
    </div>
  )
}
