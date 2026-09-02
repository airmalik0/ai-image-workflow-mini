import { NODE_SPECS } from '@workflow/contracts'
import type { NodeKind, PortSpec } from '@workflow/contracts'
import { cn } from '@/shared/lib'
import styles from './port-signature.module.css'

const shapes = (ports: Record<string, PortSpec>, side: string) =>
  Object.entries(ports).map(([name, port]) => (
    <span
      key={name}
      title={`${side} ${name}: ${port.type}`}
      className={cn(styles.shape, port.type === 'image' && styles.image)}
    />
  ))

/** Сигнатура портов типа ноды: входы, разделитель, выходы. Читается из `NODE_SPECS`. */
export const PortSignature = ({ kind }: { kind: NodeKind }) => (
  <span className={styles.group}>
    {shapes(NODE_SPECS[kind].inputs, 'вход')}
    <span className={styles.divider} />
    {shapes(NODE_SPECS[kind].outputs, 'выход')}
  </span>
)
