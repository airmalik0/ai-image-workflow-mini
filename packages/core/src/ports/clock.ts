/**
 * Источник времени отдельным портом: временные метки job'ов участвуют в тестах
 * и в Run Timeline, поэтому в тестах их полезно подменять, а не ждать реальных
 * миллисекунд.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
