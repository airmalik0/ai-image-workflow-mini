import { useMemo } from 'react'
import { cn } from '@/shared/lib'
import { Button } from '@/shared/ui'
import { SCENARIOS } from '../lib/scenarios'
import { useLoadScenario } from '../model/use-load-scenario'
import { ScenarioShape } from './scenario-shape'
import styles from './scenario-picker.module.css'

export interface ScenarioPickerProps {
  /** `cards` — крупные карточки для пустого холста, `compact` — кнопки в шапке. */
  variant?: 'cards' | 'compact' | undefined
  className?: string | undefined
}

/**
 * Три готовых графа в один клик — ровно те, что нарисованы в задании.
 * Схема на карточке строится из самого графа сценария (см. `ScenarioShape`).
 */
export const ScenarioPicker = ({ variant = 'cards', className }: ScenarioPickerProps) => {
  const load = useLoadScenario()
  // Графы строятся один раз на монтирование: они нужны только для схем на карточках.
  const shapes = useMemo(
    () => (variant === 'cards' ? SCENARIOS.map((scenario) => scenario.build()) : []),
    [variant],
  )

  if (variant === 'compact') {
    return (
      <div className={cn(styles.compact, className)} role="group" aria-label="Готовые сценарии">
        <span className={styles.compactLabel}>Сценарии</span>
        {SCENARIOS.map((scenario) => (
          <Button
            key={scenario.id}
            variant="ghost"
            size="sm"
            onClick={() => load(scenario)}
            title={`${scenario.summary} Загрузка заменит текущий граф.`}
          >
            {scenario.name}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div className={cn(styles.cards, className)} role="group" aria-label="Готовые сценарии">
      {SCENARIOS.map((scenario, index) => {
        const graph = shapes[index]
        return (
          <button
            key={scenario.id}
            type="button"
            className={styles.card}
            onClick={() => load(scenario)}
            data-scenario={scenario.id}
          >
            {graph !== undefined && <ScenarioShape graph={graph} />}
            <span className={styles.cardName}>{scenario.name}</span>
            <span className={styles.cardSummary}>{scenario.summary}</span>
          </button>
        )
      })}
    </div>
  )
}
