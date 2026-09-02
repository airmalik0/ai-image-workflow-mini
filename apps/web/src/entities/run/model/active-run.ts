import { create } from 'zustand'

export interface ActiveRunState {
  /** Запуск, за которым сейчас следит интерфейс; `null` — запусков не было. */
  runId: string | null
  setRunId: (runId: string | null) => void
}

/**
 * Идентификатор текущего запуска отдельно от графа. Граф после нажатия Run
 * продолжает правиться, а таймлайн и статусы смотрят на уже отправленный снимок —
 * держать их в одном сторе значило бы связать две разные жизни одной переменной.
 */
export const useActiveRun = create<ActiveRunState>((set) => ({
  runId: null,
  setRunId: (runId) => {
    set({ runId })
  },
}))
