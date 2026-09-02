import type { WorkflowGraph } from '@workflow/contracts'
import { canConnect } from '@workflow/core'
import type { ConnectionCheck } from '@workflow/core'
import type { Connection, Edge, FinalConnectionState } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toDomainConnection, useWorkflowStore } from '@/entities/workflow'

export interface ConnectionRejection {
  message: string
  /** Меняется на каждом отказе: подсказка должна показаться заново и при том же тексте. */
  key: number
}

/** Сколько подсказка висит на канвасе, прежде чем убраться сама. */
const REJECTION_TIMEOUT = 6000

/**
 * Проверка кандидата на соединение. Единственный источник правды — `canConnect`
 * из ядра: ровно эта функция валидирует граф на сервере, поэтому канвас не
 * повторяет её правила, а вызывает её же.
 */
export const checkConnection = (
  graph: WorkflowGraph,
  candidate: Connection | Edge,
): ConnectionCheck => {
  const connection = toDomainConnection(candidate)
  if (!connection) return { ok: false, reason: 'У соединения не указан порт' }
  return canConnect(graph, connection)
}

/** Хэндл, над которым завершилась протяжка. Тип берём у самого React Flow,
 * чтобы не путать его с одноимённым компонентом. */
type ConnectionHandle = NonNullable<FinalConnectionState['fromHandle']>

/** Пара хэндлов React Flow в доменный вид: выход всегда источник, вход — цель. */
const candidateOf = (from: ConnectionHandle, to: ConnectionHandle): Connection | null => {
  if (from.type === to.type) return null
  const [source, target] = from.type === 'source' ? [from, to] : [to, from]
  return {
    source: source.nodeId,
    sourceHandle: source.id ?? null,
    target: target.nodeId,
    targetHandle: target.id ?? null,
  }
}

/**
 * Соединение нод на канвасе. Отказ не должен быть молчаливым: причину, которую
 * вернуло ядро, показываем пользователю дословно — она уже написана по-русски.
 */
export const useConnectNodes = () => {
  const connect = useWorkflowStore((state) => state.connect)
  const [rejection, setRejection] = useState<ConnectionRejection | null>(null)
  const counter = useRef(0)

  const reject = useCallback((message: string) => {
    counter.current += 1
    setRejection({ message, key: counter.current })
  }, [])

  const dismissRejection = useCallback(() => setRejection(null), [])

  useEffect(() => {
    if (rejection === null) return
    const timer = setTimeout(() => setRejection(null), REJECTION_TIMEOUT)
    return () => clearTimeout(timer)
  }, [rejection])

  const isValidConnection = useCallback(
    (candidate: Connection | Edge) =>
      checkConnection(useWorkflowStore.getState().graph(), candidate).ok,
    [],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const check = connect(connection)
      if (check.ok) {
        setRejection(null)
        return
      }
      reject(check.reason)
    },
    [connect, reject],
  )

  /**
   * Момент, когда пользователь отпустил связь. Если React Flow её не принял,
   * объясняем почему: бросок в пустоту молчит, отказ над портом — говорит.
   */
  const onConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid === true) return

      const { fromHandle, toHandle } = state
      if (!fromHandle || !toHandle) return
      if (fromHandle.nodeId === toHandle.nodeId && fromHandle.id === toHandle.id) return

      const candidate = candidateOf(fromHandle, toHandle)
      if (!candidate) {
        reject('Соединяются только выход с входом')
        return
      }

      const check = checkConnection(useWorkflowStore.getState().graph(), candidate)
      if (!check.ok) reject(check.reason)
    },
    [reject],
  )

  return { isValidConnection, onConnect, onConnectEnd, rejection, dismissRejection }
}
