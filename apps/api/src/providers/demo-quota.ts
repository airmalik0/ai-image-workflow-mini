import type { DemoQuotaStatus } from '@workflow/contracts'
import type { Redis } from 'ioredis'

/**
 * Дневная квота демо-стенда: сколько успешных обращений к боевому провайдеру
 * ему разрешено сделать за сутки.
 *
 * Считаются именно успешные обращения. Ошибка провайдера квоту не тратит —
 * иначе упавший ключ выел бы лимит за минуту, ничего не сгенерировав.
 */
export interface DemoQuota {
  /** Потолок за сутки. `0` — предохранитель выключен. */
  readonly limit: number
  used(): Promise<number>
  /** Отметить успешное обращение. Вызывается только после удачной генерации. */
  record(): Promise<void>
}

/** Ключ счётчика: сутки в UTC, чтобы «день» не зависел от часового пояса стенда. */
export function demoQuotaKey(now: Date): string {
  return `demo:calls:${now.toISOString().slice(0, 10)}`
}

/** Ближайшая полночь UTC в секундах эпохи — момент, когда счётчик обнуляется. */
export function nextMidnightUtc(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.floor(midnight / 1000)
}

export async function readDemoQuota(quota: DemoQuota): Promise<DemoQuotaStatus> {
  const used = await quota.used()
  return { limit: quota.limit, used, exhausted: used >= quota.limit }
}

export interface RedisDemoQuotaOptions {
  redis: Redis
  limit: number
  /** Подменяемые часы: тест обязан уметь встать на 23:59 UTC. */
  now?: () => Date
}

/**
 * Счётчик в Redis. Именно общий, а не в памяти процесса: считает воркер,
 * а показывает в `/api/health` API — это два разных процесса, и своя копия
 * счётчика у каждого означала бы вдвое больший расход по факту.
 */
export class RedisDemoQuota implements DemoQuota {
  readonly limit: number
  readonly #redis: Redis
  readonly #now: () => Date

  constructor(options: RedisDemoQuotaOptions) {
    this.limit = options.limit
    this.#redis = options.redis
    this.#now = options.now ?? (() => new Date())
  }

  async used(): Promise<number> {
    const raw = await this.#redis.get(demoQuotaKey(this.#now()))
    if (raw === null) return 0
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? value : 0
  }

  async record(): Promise<void> {
    const now = this.#now()
    const key = demoQuotaKey(now)
    // EXPIREAT ставится при каждом инкременте, а не только на первом: ключ,
    // переживший рестарт Redis без TTL, иначе остался бы навсегда и запер бы
    // стенд на исчерпанной квоте.
    await this.#redis.multi().incr(key).expireat(key, nextMidnightUtc(now)).exec()
  }
}
