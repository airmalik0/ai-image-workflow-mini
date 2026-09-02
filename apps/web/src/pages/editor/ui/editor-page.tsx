import { ReactFlowProvider } from '@xyflow/react'
import { useActiveRun } from '@/entities/run'
import { ScenarioPicker } from '@/features/load-scenario'
import { DemoLimitNotice } from '@/widgets/demo-limit'
import { NodeInspector } from '@/widgets/node-inspector'
import { NodePalette } from '@/widgets/node-palette'
import { RunControls } from '@/widgets/run-controls'
import { RunTimeline } from '@/widgets/run-timeline'
import { WorkflowCanvas } from '@/widgets/workflow-canvas'
import { APP_NAME } from '@/shared/config'
import { BrandMark } from '@/shared/ui'
import styles from './editor-page.module.css'

/**
 * Редактор графа. `ReactFlowProvider` поднят над всей страницей, а не над канвасом:
 * палитра в левой колонке тоже пересчитывает экранные координаты в координаты
 * полотна, когда кладёт ноду по клику.
 *
 * Колонок по-прежнему три: таймлайн — полка внутри средней, под холстом, чтобы
 * инспектор и палитра оставались на своих местах в полный рост.
 *
 * Между шапкой и рабочей областью — ряд под объявления о состоянии стенда.
 * Пока объявлять нечего, он схлопывается в ноль: строка сетки задана `auto`.
 */
export const EditorPage = () => {
  const runId = useActiveRun((state) => state.runId)

  return (
    <ReactFlowProvider>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <span className={styles.brand}>
            <BrandMark className={styles.brandMark} />
            {APP_NAME}
          </span>
          <span className={styles.brandDivider} />
          <span className={styles.breadcrumb}>Редактор графа</span>
          <span className={styles.spacer} />
          <ScenarioPicker variant="compact" />
          <span className={styles.brandDivider} />
          <RunControls />
          <span className={styles.brandDivider} />
          <a className={styles.link} href="#/design-system">
            Дизайн-система
          </a>
        </header>

        <DemoLimitNotice />

        <div className={styles.body}>
          <aside className={styles.rail}>
            <NodePalette />
          </aside>

          <div className={styles.center}>
            <WorkflowCanvas />
            <div className={styles.timelineSlot}>
              <RunTimeline runId={runId} />
            </div>
          </div>

          <NodeInspector />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
