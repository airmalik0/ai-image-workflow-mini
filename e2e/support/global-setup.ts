import { execFileSync } from 'node:child_process'
import { FAKE_FAIL_NODES, IMAGE_PROVIDER, OWNS_STACK } from './stand.js'

/**
 * Стенд для e2e — тот же `docker compose`, который получает проверяющий, а не
 * dev-сервер Vite: тесты обязаны ходить через nginx, иначе проксирование SSE
 * (единственное место, где поток статусов может встать буфером) не проверяется
 * вообще.
 *
 * `up` вызывается всегда, а не «если порт не отвечает»: compose сверяет
 * конфигурацию и пересоздаёт контейнеры, если окружение изменилось. Иначе уже
 * поднятый стенд без `FAKE_FAIL_NODES` молча превратил бы сценарий retry
 * в зелёный прогон, который ничего не проверил.
 */
export default function raiseStack(): void {
  if (!OWNS_STACK) return

  execFileSync('docker', ['compose', 'up', '-d', '--wait', '--build'], {
    stdio: 'inherit',
    env: { ...process.env, IMAGE_PROVIDER, FAKE_FAIL_NODES },
  })
}
