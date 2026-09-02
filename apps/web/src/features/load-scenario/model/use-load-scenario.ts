import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/entities/workflow'
import type { Scenario } from '../lib/scenarios'

/**
 * Загрузка готового сценария на холст. Граф кладётся целиком и вид подгоняется
 * под него на следующем кадре: до отрисовки React Flow ещё не знает размеров
 * нод, и `fitView` подогнал бы вид под нули.
 */
export const useLoadScenario = (): ((scenario: Scenario) => void) => {
  const setGraph = useWorkflowStore((store) => store.setGraph)
  const { fitView } = useReactFlow()

  return useCallback(
    (scenario: Scenario) => {
      setGraph(scenario.build())
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 320 })
      })
    },
    [fitView, setGraph],
  )
}
