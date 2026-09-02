import type { ValidationIssue } from '@workflow/contracts'
import { validateGraph } from '@workflow/core'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useKeyPress,
} from '@xyflow/react'
import type { DragEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { NodeControlsProvider, NodeRunProvider, workflowNodeTypes } from '@/entities/node'
import { usePresets } from '@/entities/preset'
import { jobsByNode, useActiveRun, useRunState, useRunStream } from '@/entities/run'
import { toWorkflowGraph, useWorkflowStore } from '@/entities/workflow'
import { readDraggedKind, useAddNode } from '@/features/add-node'
import { useConnectNodes } from '@/features/connect-nodes'
import { ScenarioPicker } from '@/features/load-scenario'
import { useRetryJob } from '@/features/retry-job'
import { useModels } from '@/features/select-model'
import { describeApiError } from '@/shared/api'
import { cn } from '@/shared/lib'
import { Button, Notice } from '@/shared/ui'
import styles from './workflow-canvas.module.css'

/** Ссылка на реестр не должна меняться между рендерами — React Flow пересоберёт ноды. */
const nodeTypes = workflowNodeTypes

/** Копирование и вставка: Cmd на macOS, Ctrl на остальных. */
const COPY_KEYS = ['Meta+c', 'Control+c']
const PASTE_KEYS = ['Meta+v', 'Control+v']
const SELECT_ALL_KEYS = ['Meta+a', 'Control+a']
const DELETE_KEYS = ['Delete', 'Backspace']
// В полях ввода Cmd+C обязан копировать текст, а не ноды.
const KEY_OPTIONS = { actInsideInputWithModifier: false }
/** Миникарта меньше стандартной: она подсказка, а не второй канвас. */
const MINIMAP_SIZE = { width: 168, height: 112 }

type Problem = ValidationIssue & { tone: 'error' | 'warning' }

export const WorkflowCanvas = () => {
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange)
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange)
  const copySelection = useWorkflowStore((state) => state.copySelection)
  const paste = useWorkflowStore((state) => state.paste)
  const selectAll = useWorkflowStore((state) => state.selectAll)
  const removeSelection = useWorkflowStore((state) => state.removeSelection)
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const hasClipboard = useWorkflowStore((state) => state.clipboard !== null)

  // Карточки нод — презентационные: списки моделей и пресетов и правку параметров
  // им подаёт виджет, потому что `entities` не может зависеть от слоёв выше.
  const { models, error: modelsError } = useModels()
  const { presets, error: presetsError } = usePresets()
  const nodeControls = useMemo(
    () => ({ models, presets, updateNodeData }),
    [models, presets, updateNodeData],
  )
  // Справочники грузятся одним и тем же API: упал он — упали оба, показываем первую причину.
  const apiError = modelsError ?? presetsError

  /*
   * Подписка на события запуска живёт здесь — там же, где рисуются статусы нод.
   * Одна подписка на страницу: `useRunStream` открывает ровно один `EventSource`,
   * а состояние он кладёт в кэш запроса, из которого его читают и таймлайн, и пульт.
   */
  const runId = useActiveRun((state) => state.runId)
  useRunStream(runId)
  const { state: runState } = useRunState(runId)
  const retry = useRetryJob()

  // Статусы доставляются контекстом, а не полем в `data`: `data` уезжает на сервер
  // в теле запуска и валидируется схемой контракта — статусу job'а там не место.
  const nodeRun = useMemo(
    () => ({
      jobs: jobsByNode(runState),
      retry: retry.retry,
      pendingNodeId: retry.pendingNodeId,
      error: retry.error,
    }),
    [runState, retry.retry, retry.pendingNodeId, retry.error],
  )

  const { isValidConnection, onConnect, onConnectEnd, rejection, dismissRejection } =
    useConnectNodes()
  const { addAtPointer } = useAddNode()

  const copyPressed = useKeyPress(COPY_KEYS, KEY_OPTIONS)
  const pastePressed = useKeyPress(PASTE_KEYS, KEY_OPTIONS)
  const selectAllPressed = useKeyPress(SELECT_ALL_KEYS, KEY_OPTIONS)

  useEffect(() => {
    if (copyPressed) copySelection()
  }, [copyPressed, copySelection])

  useEffect(() => {
    if (pastePressed) paste()
  }, [pastePressed, paste])

  useEffect(() => {
    if (selectAllPressed) selectAll()
  }, [selectAllPressed, selectAll])

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const kind = readDraggedKind(event)
      if (kind === null) return
      addAtPointer(kind, { x: event.clientX, y: event.clientY })
    },
    [addAtPointer],
  )

  const selectedNodes = nodes.filter((node) => node.selected === true).length
  const selectedEdges = edges.filter((edge) => edge.selected === true).length
  const hasSelection = selectedNodes + selectedEdges > 0

  // Тот же валидатор, что проверит граф на сервере перед запуском.
  const validation = useMemo(() => validateGraph(toWorkflowGraph(nodes, edges)), [nodes, edges])
  const problems: Problem[] = useMemo(
    () => [
      ...validation.errors.map((issue): Problem => ({ ...issue, tone: 'error' })),
      ...validation.warnings.map((issue): Problem => ({ ...issue, tone: 'warning' })),
    ],
    [validation],
  )

  const [issuesOpen, setIssuesOpen] = useState(false)
  const issuesId = useId()
  const hasSomethingToShow = problems.length > 0 || apiError !== null

  /** Клик по проблеме подсвечивает её виновника на холсте — иначе искать вручную. */
  const focusIssue = useCallback(
    (issue: ValidationIssue) => {
      if (issue.nodeId !== undefined) {
        onNodesChange(
          useWorkflowStore.getState().nodes.map((node) => ({
            id: node.id,
            type: 'select' as const,
            selected: node.id === issue.nodeId,
          })),
        )
      }
      if (issue.edgeId !== undefined) {
        onEdgesChange(
          useWorkflowStore.getState().edges.map((edge) => ({
            id: edge.id,
            type: 'select' as const,
            selected: edge.id === issue.edgeId,
          })),
        )
      }
    },
    [onEdgesChange, onNodesChange],
  )

  return (
    <div className={styles.canvas}>
      <div className={styles.flow} onDragOver={onDragOver} onDrop={onDrop}>
        <NodeControlsProvider value={nodeControls}>
          <NodeRunProvider value={nodeRun}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              deleteKeyCode={DELETE_KEYS}
              snapToGrid
              snapGrid={[16, 16]}
              connectionRadius={26}
              minZoom={0.25}
              maxZoom={2}
              proOptions={{ hideAttribution: false }}
              attributionPosition="bottom-left"
              aria-label="Граф workflow"
            >
              {/* Две сетки: мелкая задаёт шаг привязки, крупная — масштаб полотна. */}
              <Background id="fine" variant={BackgroundVariant.Dots} gap={16} size={1} />
              <Background
                id="coarse"
                variant={BackgroundVariant.Dots}
                gap={96}
                size={2}
                color="#34343d"
              />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeBorderRadius={6}
                ariaLabel="Миникарта графа"
                style={MINIMAP_SIZE}
              />
            </ReactFlow>
          </NodeRunProvider>
        </NodeControlsProvider>

        {nodes.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Холст пуст</span>
            <p className={styles.emptyText}>
              Начните с готового сценария из задания — или перетащите тип ноды из палитры слева.
              Связи тянутся от круглого или квадратного порта к порту того же типа.
            </p>
            <ScenarioPicker className={styles.scenarios} />
          </div>
        )}

        {issuesOpen && hasSomethingToShow && (
          <div className={styles.issues} id={issuesId} role="region" aria-label="Проблемы">
            {apiError !== null &&
              (() => {
                const described = describeApiError(apiError)
                return (
                  <Notice
                    title={described.title}
                    code={described.code}
                    {...(described.hint === null ? {} : { hint: described.hint })}
                  >
                    {described.message}
                  </Notice>
                )
              })()}

            {problems.length > 0 && (
              <ul className={styles.issueList}>
                {problems.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    <button
                      type="button"
                      className={cn(styles.issue, styles[issue.tone])}
                      onClick={() => focusIssue(issue)}
                      title="Показать виновника на холсте"
                    >
                      <span className={styles.issueMark} aria-hidden="true" />
                      <span className={styles.issueText}>{issue.message}</span>
                      <code className={styles.issueCode}>{issue.code}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {rejection !== null && (
          <div className={styles.rejection} role="status" key={rejection.key}>
            <span className={styles.rejectionMark} aria-hidden="true" />
            <span className={styles.rejectionText}>{rejection.message}</span>
            <button
              type="button"
              className={styles.rejectionClose}
              onClick={dismissRejection}
              aria-label="Скрыть подсказку"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className={styles.statusBar}>
        <span className={styles.counts}>
          <span>{nodes.length} нод</span>
          <span>{edges.length} связей</span>
          {hasSelection && (
            <span className={styles.selection}>
              выделено: {selectedNodes} нод, {selectedEdges} связей
            </span>
          )}
        </span>

        <span className={styles.divider} />

        {nodes.length === 0 ? (
          <span className={styles.validity}>
            <span className={styles.validityMark} aria-hidden="true" />
            граф пуст
          </span>
        ) : problems.length === 0 ? (
          <span className={cn(styles.validity, styles.valid)}>
            <span className={styles.validityMark} aria-hidden="true" />
            граф валиден
          </span>
        ) : (
          <button
            type="button"
            className={cn(
              styles.validity,
              styles.validityButton,
              validation.errors.length > 0 ? styles.invalid : styles.warned,
            )}
            onClick={() => setIssuesOpen((value) => !value)}
            aria-expanded={issuesOpen}
            aria-controls={issuesId}
          >
            <span className={styles.validityMark} aria-hidden="true" />
            {validation.errors.length > 0
              ? `ошибок в графе: ${validation.errors.length}`
              : `предупреждений: ${validation.warnings.length}`}
          </button>
        )}

        {apiError !== null && (
          <button
            type="button"
            className={cn(styles.validity, styles.validityButton, styles.invalid)}
            onClick={() => setIssuesOpen((value) => !value)}
            aria-expanded={issuesOpen}
            aria-controls={issuesId}
          >
            <span className={styles.validityMark} aria-hidden="true" />
            API недоступен
          </button>
        )}

        <span className={styles.spacer} />

        <span className={styles.hotkeys}>
          <span>
            <kbd className={styles.key}>Shift</kbd>рамка выделения
          </span>
          <span>
            <kbd className={styles.key}>Del</kbd>удалить
          </span>
        </span>

        <span className={styles.divider} />

        <span className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={copySelection} disabled={selectedNodes === 0}>
            Копировать
          </Button>
          <Button variant="ghost" size="sm" onClick={paste} disabled={!hasClipboard}>
            Вставить
          </Button>
          <Button variant="ghost" size="sm" onClick={removeSelection} disabled={!hasSelection}>
            Удалить
          </Button>
        </span>
      </div>
    </div>
  )
}
