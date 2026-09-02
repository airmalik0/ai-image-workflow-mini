import type { DemoQuota } from '../providers/demo-quota.js'

/**
 * Дневная квота в памяти. Redis тестам предохранителя не нужен: проверяется
 * решение «боевой или офлайновый», а не хранение счётчика — оно проверяется
 * отдельно, против настоящего Redis.
 */
export class InMemoryDemoQuota implements DemoQuota {
  readonly limit: number
  #used: number

  constructor(limit: number, used = 0) {
    this.limit = limit
    this.#used = used
  }

  used(): Promise<number> {
    return Promise.resolve(this.#used)
  }

  record(): Promise<void> {
    this.#used += 1
    return Promise.resolve()
  }
}
