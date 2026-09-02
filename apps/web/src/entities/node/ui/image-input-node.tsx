import type { NodeDataOf } from '@workflow/contracts'
import type { Node, NodeProps } from '@xyflow/react'
import { fileUrl } from '@/shared/api'
import { NodeShell } from './node-shell'
import styles from './node.module.css'

export type ImageInputFlowNode = Node<NodeDataOf<'imageInput'>, 'imageInput'>

/**
 * Исходное изображение. В `data` лежит только `fileId` — байты живут в FileStorage
 * и приезжают отдельным запросом; хранить содержимое файла в графе нельзя, он ходит
 * в теле каждого запуска.
 */
export const ImageInputNode = ({ id, data, selected }: NodeProps<ImageInputFlowNode>) => (
  <NodeShell kind="imageInput" id={id} selected={selected === true}>
    {data.fileId === null ? (
      <div className={styles.frame}>Файл не выбран</div>
    ) : (
      <img className={styles.preview} src={fileUrl(data.fileId)} alt="Загруженное изображение" />
    )}
  </NodeShell>
)
