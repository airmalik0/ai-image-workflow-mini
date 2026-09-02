import type { RunState, RunStatus } from '@workflow/contracts'
import { useId, useMemo, useState } from 'react'
import { NODE_LABELS } from '@/entities/node'
import { RUN_STATUS_LABELS } from '@/entities/run'
import { describeApiError, describeJobError } from '@/shared/api'
import { cn } from '@/shared/lib'
import { Button, Notice, STATUS_LABELS } from '@/shared/ui'
import { buildTimeline, formatDuration, rowsInWindow, widestOverlap } from '../lib/timeline-layout'
import type { TimelineModel, TimelineRow } from '../lib/timeline-layout'
import styles from './run-timeline.module.css'

export interface RunTimelineViewProps {
  /** `null` — запусков ещё не было. */
  state: RunState | null
  isLoading?: boolean | undefined
  error?: Error | null | undefined
  /** Момент «сейчас» для незавершённых полос; задаётся в тестах и на витрине. */
  now?: number | undefined
  selectedNodeId?: string | null | undefined
  onSelectNode?: ((nodeId: string) => void) | undefined
  defaultOpen?: boolean | undefined
  /** Повтор упавшей ноды прямо из разбора ошибок; `null` — повторять некому. */
  onRetry?: ((nodeId: string) => void) | null | undefined
  /** Нода, чей повтор сейчас в полёте. */
  retryingNodeId?: string | null | undefined
}

const pct = (value: number): string => `${(value * 100).toFixed(3)}%`

/* Классы вынесены в таблицу, а не собираются из статуса: имена статусов run'а и
   job'а частично совпадают, и общий namespace CSS-модуля их бы склеил. */
const RUN_STATUS_CLASS: Record<RunStatus, string> = {
  queued: styles.runQueued ?? '',
  running: styles.runRunning ?? '',
  completed: styles.runCompleted ?? '',
  failed: styles.runFailed ?? '',
  cancelled: styles.runCancelled ?? '',
}

/**
 * Подпись строки: «Генерация 1» вместо «generateImage-1». Номер берётся из
 * идентификатора — две одинаковые ноды в ветвлении иначе неразличимы в тексте.
 */
const rowTitle = (row: TimelineRow): string => {
  const label = row.kind === null ? row.nodeId : NODE_LABELS[row.kind]
  const index = /-(\d+)$/.exec(row.nodeId)?.[1]
  return index === undefined ? label : `${label} ${index}`
}

/**
 * Где писать длительность: в широкой полосе она помещается внутри, у короткой
 * выносится наружу, а у прижатой к правому краю — влево, иначе её срежет край.
 */
const labelSide = (bar: NonNullable<TimelineRow['bar']>): string => {
  if (bar.width >= 0.12) return styles.barLabelInside ?? ''
  return bar.offset + bar.width > 0.8 ? (styles.barLabelLeft ?? '') : (styles.barLabelRight ?? '')
}

const barTooltip = (row: TimelineRow): string => {
  const parts = [`${rowTitle(row)} · ${STATUS_LABELS[row.status]}`, `нода ${row.nodeId}`]
  if (row.bar !== null) {
    parts.push(
      `старт +${formatDuration(row.bar.startMs)}`,
      `длительность ${formatDuration(row.bar.durationMs)}${row.bar.open ? ' и продолжается' : ''}`,
    )
  }
  parts.push(`попытка ${row.attempt}`)
  if (row.error !== null) parts.push(`${row.error.code}: ${row.error.message}`)
  return parts.join('\n')
}

/** Вывод о параллелизме — единственное, ради чего таймлайн вообще нужен. */
const Verdict = ({ model }: { model: TimelineModel }) => {
  const window = widestOverlap(model)
  if (window === null) {
    return (
      <p className={styles.verdict}>
        Полосы не перекрываются: job&apos;ы шли по очереди — параллелить в этом графе нечего.
      </p>
    )
  }

  const names = rowsInWindow(model.rows, window).map(rowTitle)
  return (
    <p className={styles.verdict}>
      <b className={styles.verdictNames}>{names.join(' и ')}</b> выполнялись одновременно{' '}
      <b>{formatDuration(window.endMs - window.startMs)}</b> — полосы ниже перекрыты по времени.
      Последовательно те же job&apos;ы заняли бы ≈ {formatDuration(model.spanMs + model.savedMs)}{' '}
      вместо {formatDuration(model.spanMs)}.
    </p>
  )
}

const Chart = ({
  model,
  selectedNodeId,
  onSelectNode,
}: {
  model: TimelineModel
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) => (
  <div className={styles.chart}>
    <div className={styles.overlay} aria-hidden="true">
      {model.ticks.map((tick) => (
        <span key={tick.ms} className={styles.gridline} style={{ left: pct(tick.offset) }} />
      ))}
      {model.overlaps.map((window) => (
        <span
          key={window.startMs}
          className={styles.band}
          style={{ left: pct(window.offset), width: pct(window.width) }}
          data-testid="overlap-band"
        >
          {window.width >= 0.04 && (
            <span className={styles.bandLabel}>{window.peak} одновременно</span>
          )}
        </span>
      ))}
    </div>

    <ol className={styles.rows}>
      {model.rows.map((row) => (
        <li key={row.jobId}>
          <button
            type="button"
            className={cn(styles.row, selectedNodeId === row.nodeId && styles.rowSelected)}
            onClick={() => onSelectNode(row.nodeId)}
            aria-pressed={selectedNodeId === row.nodeId}
            title={barTooltip(row)}
            data-node-id={row.nodeId}
          >
            <span className={styles.label}>
              <span className={styles.name}>{rowTitle(row)}</span>
              <span className={styles.nodeId}>{row.nodeId}</span>
            </span>

            <span className={styles.track}>
              {row.bar === null ? (
                <span className={cn(styles.pending, styles[row.status])}>
                  {STATUS_LABELS[row.status]}
                </span>
              ) : (
                <span
                  className={cn(styles.bar, styles[row.status], row.bar.open && styles.open)}
                  style={{ left: pct(row.bar.offset), width: pct(row.bar.width) }}
                  data-testid="timeline-bar"
                  data-offset={row.bar.offset.toFixed(6)}
                  data-width={row.bar.width.toFixed(6)}
                >
                  <span className={cn(styles.barLabel, labelSide(row.bar))}>
                    {formatDuration(row.bar.durationMs)}
                    {row.attempt > 1 && (
                      <span className={styles.attempt} title={`попытка ${row.attempt}`}>
                        ×{row.attempt}
                      </span>
                    )}
                  </span>
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>

    <div className={styles.axis} aria-hidden="true">
      <span className={styles.axisPad} />
      <span className={styles.axisTrack}>
        {model.ticks
          .filter((tick) => 1 - tick.offset > 0.1 || tick.ms === 0)
          .map((tick) => (
            <span
              key={tick.ms}
              className={cn(styles.tick, tick.ms === 0 && styles.tickStart)}
              style={{ left: pct(tick.offset) }}
            >
              {tick.ms === 0 ? '0' : formatDuration(tick.ms)}
            </span>
          ))}
        <span className={cn(styles.tick, styles.tickEnd)}>{formatDuration(model.spanMs)}</span>
      </span>
    </div>
  </div>
)

/** Ошибки job'ов — с кодом и текстом провайдера, а не «что-то пошло не так». */
const Failures = ({
  rows,
  onRetry,
  retryingNodeId,
}: {
  rows: TimelineRow[]
  onRetry: ((nodeId: string) => void) | null
  retryingNodeId: string | null
}) => (
  <div className={styles.failures}>
    {rows.map((row) => {
      if (row.error === null) return null
      const described = describeJobError(row.error)
      const retryable = described.retryable === true
      return (
        <Notice
          key={row.jobId}
          title={`${rowTitle(row)}: ${described.title}`}
          code={described.code}
          hint={
            retryable
              ? (described.hint ?? 'Ошибка помечена как повторяемая — повтор имеет смысл')
              : (described.hint ?? 'Ошибка не повторяемая: повтор даст тот же результат')
          }
          actions={
            onRetry === null ? undefined : (
              <Button
                size="sm"
                variant={retryable ? 'primary' : 'ghost'}
                loading={retryingNodeId === row.nodeId}
                onClick={() => onRetry(row.nodeId)}
              >
                {retryable ? 'Повторить' : 'Повторить всё равно'}
              </Button>
            )
          }
        >
          {described.message}
        </Notice>
      )
    })}
  </div>
)

const EmptyState = () => (
  <div className={styles.empty}>
    <span className={styles.emptyTitle}>Запуска ещё не было</span>
    <p className={styles.emptyText}>
      После нажатия Run здесь появится по полосе на каждый job: ось — миллисекунды от старта
      запуска, цвет — статус, ширина — длительность. Полосы независимых веток встанут друг над
      другом на одном отрезке времени — это и есть параллельное выполнение.
    </p>
  </div>
)

/**
 * Диаграмма Ганта запуска. Компонент презентационный: состояние ему подают —
 * из кэша запроса в редакторе и готовой фикстурой на витрине дизайн-системы.
 */
export const RunTimelineView = ({
  state,
  isLoading = false,
  error = null,
  now,
  selectedNodeId = null,
  onSelectNode,
  defaultOpen = true,
  onRetry = null,
  retryingNodeId = null,
}: RunTimelineViewProps) => {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  const model = useMemo(
    () => (state === null ? null : buildTimeline(state, now === undefined ? {} : { now })),
    [state, now],
  )
  /* Пропущенная нода тоже несёт `error` — там записано, почему её не стали
     выполнять. Это объяснение, а не отказ: в разборе ошибок ей не место. */
  const failed =
    model === null ? [] : model.rows.filter((row) => row.status === 'error' && row.error !== null)

  return (
    <section className={styles.timeline} aria-label="Таймлайн запуска">
      <header className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <span className={cn(styles.chevron, open && styles.chevronOpen)} aria-hidden="true" />
          Таймлайн запуска
        </button>

        {state !== null && (
          <>
            <span className={styles.runId}>{state.run.id}</span>
            <span className={cn(styles.runStatus, RUN_STATUS_CLASS[state.run.status])}>
              {RUN_STATUS_LABELS[state.run.status]}
            </span>
          </>
        )}

        <span className={styles.spacer} />

        {model !== null && model.rows.length > 0 && (
          <span className={styles.stats}>
            <span className={styles.stat}>
              <b>{formatDuration(model.spanMs)}</b> прогон
            </span>
            <span className={styles.stat}>
              <b>{model.peakConcurrency}</b> одновременно
            </span>
            <span className={styles.stat} title="Сумма длительностей минус занятое время">
              <b>{formatDuration(model.savedMs)}</b> внахлёст
            </span>
          </span>
        )}
      </header>

      {open && (
        <div className={styles.body} id={bodyId}>
          {error !== null ? (
            (() => {
              const described = describeApiError(error)
              return (
                <Notice
                  title={described.title}
                  code={described.code}
                  {...(described.hint === null ? {} : { hint: described.hint })}
                >
                  {described.message}
                </Notice>
              )
            })()
          ) : isLoading ? (
            <p className={styles.loading}>Загружаем состояние запуска…</p>
          ) : model === null ? (
            <EmptyState />
          ) : model.rows.length === 0 ? (
            <p className={styles.loading}>
              Запуск создан, job&apos;ы ещё не поставлены в очередь — полосы появятся сами.
            </p>
          ) : (
            <>
              <Verdict model={model} />
              <Chart
                model={model}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode ?? (() => undefined)}
              />
              {failed.length > 0 && (
                <Failures rows={failed} onRetry={onRetry} retryingNodeId={retryingNodeId} />
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
