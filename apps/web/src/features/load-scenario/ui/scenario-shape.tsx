import type { WorkflowGraph } from '@workflow/contracts'
import { NODE_LABELS } from '@/entities/node'
import styles from './scenario-picker.module.css'

/* Схема рисуется не в координатах холста, а в сетке: колонка берётся из порядка
   x-координат ноды, ряд — из порядка y. Так все три схемы получают одинаковый
   масштаб и одинаковую высоту карточки, оставаясь производными от самого графа. */
const BOX = { width: 104, height: 34 }
const GAP = { x: 34, y: 14 }
const CANVAS_HEIGHT = 118

const rank = (values: number[]): Map<number, number> =>
  new Map([...new Set(values)].sort((a, b) => a - b).map((value, index) => [value, index]))

/**
 * Схема сценария строится по его же графу: подпись под кнопкой не может
 * разойтись с тем, что она на самом деле положит на холст.
 */
export const ScenarioShape = ({ graph }: { graph: WorkflowGraph }) => {
  const columns = rank(graph.nodes.map((node) => node.position.x))
  const rows = rank(graph.nodes.map((node) => node.position.y))

  const width = columns.size * (BOX.width + GAP.x) - GAP.x
  const stackHeight = rows.size * (BOX.height + GAP.y) - GAP.y
  const top = (CANVAS_HEIGHT - stackHeight) / 2

  const place = (position: { x: number; y: number }) => ({
    x: (columns.get(position.x) ?? 0) * (BOX.width + GAP.x),
    y: top + (rows.get(position.y) ?? 0) * (BOX.height + GAP.y),
  })

  return (
    <svg className={styles.shape} viewBox={`0 0 ${width} ${CANVAS_HEIGHT}`} aria-hidden="true">
      {graph.edges.map((edge) => {
        const from = graph.nodes.find((node) => node.id === edge.source)
        const to = graph.nodes.find((node) => node.id === edge.target)
        if (from === undefined || to === undefined) return null
        const start = place(from.position)
        const end = place(to.position)
        const x1 = start.x + BOX.width
        const y1 = start.y + BOX.height / 2
        const y2 = end.y + BOX.height / 2
        const bend = (end.x - x1) / 2
        return (
          <path
            key={edge.id}
            className={styles.shapeEdge}
            d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${end.x - bend} ${y2}, ${end.x} ${y2}`}
          />
        )
      })}

      {graph.nodes.map((node) => {
        const { x, y } = place(node.position)
        return (
          <g key={node.id}>
            <rect
              className={styles.shapeNode}
              x={x}
              y={y}
              width={BOX.width}
              height={BOX.height}
              rx={8}
            />
            <text
              className={styles.shapeLabel}
              x={x + BOX.width / 2}
              y={y + BOX.height / 2}
              dominantBaseline="central"
              textAnchor="middle"
            >
              {NODE_LABELS[node.kind]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
