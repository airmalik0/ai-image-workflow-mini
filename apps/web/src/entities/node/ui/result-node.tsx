import type { NodeDataOf } from '@workflow/contracts'
import type { Node, NodeProps } from '@xyflow/react'
import { useNodeRun } from '../model/node-controls'
import { NodeImage } from './node-image'
import { NodeShell } from './node-shell'
import styles from './node.module.css'

export type ResultFlowNode = Node<NodeDataOf<'result'>, 'result'>

/** Что показывает рамка, пока картинки нет: состояние ветки, а не общее «пусто». */
const PLACEHOLDER: Record<string, string> = {
  idle: 'Результат ветки появится после запуска',
  queued: 'Ветка в очереди',
  running: 'Ветка выполняется…',
  error: 'Ветка не дошла до результата',
  skipped: 'Ветка пропущена: предшественник не выполнен',
}

/**
 * Терминал ветки. Ничего не считает: показывает изображение, пришедшее по входу
 * `image`, — и по клику открывает его в полном размере.
 */
export const ResultNode = ({ id, selected }: NodeProps<ResultFlowNode>) => {
  const run = useNodeRun(id)

  return (
    <NodeShell kind="result" id={id} selected={selected === true}>
      {run.imageFileId === null ? (
        <div className={styles.frame}>{PLACEHOLDER[run.status] ?? 'Результат ветки'}</div>
      ) : (
        <NodeImage fileId={run.imageFileId} title={`Результат ${id}`} />
      )}
    </NodeShell>
  )
}
