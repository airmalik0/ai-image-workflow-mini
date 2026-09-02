import type { Job, JobStatus, ModelDescriptor } from '@workflow/contracts'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** Пресет в том объёме, в каком его показывает карточка ноды. */
export interface NodePresetOption {
  id: string
  name: string
}

export interface NodeControls {
  models: readonly ModelDescriptor[]
  presets: readonly NodePresetOption[]
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
}

const NodeControlsContext = createContext<NodeControls | null>(null)

/**
 * Списки моделей и пресетов приходят с сервера, а правка параметров живёт в сторе
 * графа — и то и другое лежит в слоях выше `entities`. Карточка ноды получает их
 * через контекст, поэтому остаётся презентационной и не тянет вверх по слоям.
 *
 * Контекста может не быть: тогда карточка показывает значения, но не даёт их менять.
 */
export const NodeControlsProvider = ({
  value,
  children,
}: {
  value: NodeControls
  children: ReactNode
}) => <NodeControlsContext.Provider value={value}>{children}</NodeControlsContext.Provider>

export const useNodeControls = (): NodeControls | null => useContext(NodeControlsContext)

// --- Состояние запуска на карточке ноды -------------------------------------

export interface NodeRunControls {
  /** Job'ы текущего запуска по идентификатору ноды. */
  jobs: ReadonlyMap<string, Job>
  /** Повтор упавшей ноды; `null` — запуска нет, повторять нечего. */
  retry: ((nodeId: string) => void) | null
  /** Нода, чей повтор сейчас в полёте. */
  pendingNodeId: string | null
  /** Отказ на запрос повтора — например, «нода ещё выполняется». */
  error: { nodeId: string; error: unknown } | null
}

/** Всё, что карточке ноды нужно знать о своём job'е. */
export interface NodeRunView {
  status: JobStatus
  job: Job | null
  /** Готовое изображение ноды; `null` — его ещё нет. */
  imageFileId: string | null
  /** Повторить эту ноду; `null` — повтор недоступен. */
  retry: (() => void) | null
  isRetrying: boolean
  /** Ошибка запроса на повтор именно этой ноды. */
  retryError: unknown
}

const NodeRunContext = createContext<NodeRunControls | null>(null)

/**
 * Статус ноды доставляется контекстом, а не полем в `data`: `data` валидируется
 * схемой из контрактов и целиком уезжает на сервер в теле запуска — статусу там
 * не место. Ноду при этом ничего не заставляет знать про SSE и кэш запросов:
 * она читает готовый `NodeRunView`.
 */
export const NodeRunProvider = ({
  value,
  children,
}: {
  value: NodeRunControls
  children: ReactNode
}) => <NodeRunContext.Provider value={value}>{children}</NodeRunContext.Provider>

const IDLE: NodeRunView = {
  status: 'idle',
  job: null,
  imageFileId: null,
  retry: null,
  isRetrying: false,
  retryError: null,
}

export const useNodeRun = (nodeId: string): NodeRunView => {
  const controls = useContext(NodeRunContext)
  if (controls === null) return IDLE

  const job = controls.jobs.get(nodeId) ?? null
  const retry = controls.retry
  return {
    // job'а ещё нет — нода не запускалась; это `idle`, а не отсутствие данных
    status: job?.status ?? 'idle',
    job,
    imageFileId: job?.output?.type === 'image' ? job.output.fileId : null,
    retry: retry === null ? null : () => retry(nodeId),
    isRetrying: controls.pendingNodeId === nodeId,
    retryError: controls.error?.nodeId === nodeId ? controls.error.error : null,
  }
}
