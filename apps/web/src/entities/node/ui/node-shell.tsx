import { NODE_SPECS } from '@workflow/contracts'
import type { JobStatus, NodeKind, PortSpec } from '@workflow/contracts'
import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { StatusPill } from '@/shared/ui'
import { NODE_LABELS } from '../lib/node-meta'
import { useNodeRun } from '../model/node-controls'
import { NodeRunStatus } from './node-run-status'
import styles from './node.module.css'

export interface NodeShellProps {
  kind: NodeKind
  id: string
  selected: boolean
  /**
   * Статус job'а этой ноды. Обычно приходит из контекста запуска — параметр нужен
   * витрине дизайн-системы, где карточку показывают во всех состояниях сразу.
   */
  status?: JobStatus | undefined
  /** Модификатор карточки — например, широкая панель генерации. */
  className?: string | undefined
  children?: ReactNode
}

const portEntries = (ports: Record<string, PortSpec>): [string, PortSpec][] => Object.entries(ports)

/**
 * Общая часть всех пяти нод: шапка со статусом и порты. Порты не перечисляются
 * руками — они читаются из `NODE_SPECS`, поэтому канвас физически не может
 * разойтись с контрактом, по которому валидируется граф.
 *
 * Подписи портов намеренно оставлены в исходном виде (`prompt`, `image`):
 * ровно этими именами их называют сообщения об ошибках из ядра.
 */
export const NodeShell = ({ kind, id, selected, status, className, children }: NodeShellProps) => {
  const spec = NODE_SPECS[kind]
  const inputs = portEntries(spec.inputs)
  const outputs = portEntries(spec.outputs)
  const run = useNodeRun(id)
  // Явный статус выигрывает у контекста: витрина показывает карточки состояниями,
  // а не запуском. В редакторе параметр не задаётся, и статус приходит из потока.
  const shown = status ?? run.status

  return (
    <article
      className={cn(
        styles.card,
        selected && styles.selected,
        shown === 'skipped' && styles.dimmed,
        className,
      )}
      data-status={shown}
    >
      <header className={styles.header}>
        <span className={styles.heading}>
          <span className={styles.kind}>{NODE_LABELS[kind]}</span>
          <span className={styles.id}>{id}</span>
        </span>
        <StatusPill status={shown} size="sm" />
      </header>

      {(children !== undefined || shown === 'error') && (
        <div className={styles.body}>
          {children}
          <NodeRunStatus run={run} />
        </div>
      )}

      <div className={styles.ports}>
        <ul className={styles.portColumn}>
          {inputs.map(([name, port]) => (
            <li key={name} className={styles.portRow}>
              <Handle
                type="target"
                position={Position.Left}
                id={name}
                data-port-type={port.type}
                className={styles.handleIn}
                title={`вход ${name}: ${port.type}${port.required ? ', обязательный' : ''}`}
              />
              {name}
              {port.required && (
                <span className={styles.required} title="обязательный вход">
                  *
                </span>
              )}
            </li>
          ))}
          {inputs.length === 0 && <li className={styles.portsEmpty}>нет входов</li>}
        </ul>

        <ul className={cn(styles.portColumn, styles.portOut)}>
          {outputs.map(([name, port]) => (
            <li key={name} className={styles.portRow}>
              {name}
              <Handle
                type="source"
                position={Position.Right}
                id={name}
                data-port-type={port.type}
                className={styles.handleOut}
                title={`выход ${name}: ${port.type}`}
              />
            </li>
          ))}
          {outputs.length === 0 && <li className={styles.portsEmpty}>нет выходов</li>}
        </ul>
      </div>
    </article>
  )
}
