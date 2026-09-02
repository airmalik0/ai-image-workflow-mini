import { MAX_PROMPT_LENGTH } from '@workflow/contracts'
import type { NodeDataOf } from '@workflow/contracts'
import type { Node, NodeProps } from '@xyflow/react'
import { cn } from '@/shared/lib'
import { NodeShell } from './node-shell'
import styles from './node.module.css'

export type PromptFlowNode = Node<NodeDataOf<'prompt'>, 'prompt'>

export const PromptNode = ({ id, data, selected }: NodeProps<PromptFlowNode>) => (
  <NodeShell kind="prompt" id={id} selected={selected === true}>
    <p className={cn(styles.text, data.text === '' && styles.placeholder)}>
      {data.text === '' ? 'Текст не задан' : data.text}
    </p>
    <span className={styles.counter}>
      {data.text.length} / {MAX_PROMPT_LENGTH}
    </span>
  </NodeShell>
)
