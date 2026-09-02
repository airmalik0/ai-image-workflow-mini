import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, OWNS_STACK } from './e2e/support/stand.js'

const ci = process.env['CI'] !== undefined

/**
 * E2E идут против собранного стенда (`docker compose`), а не против dev-сервера:
 * базовый адрес — nginx, поэтому проверяются и проксирование SSE, и раздача
 * файлов, и то, что фронт собран, а не пересобирается на лету.
 *
 * `E2E_BASE_URL` переключает прогон на чужое окружение (dev-сервер Vite,
 * публичное демо); тогда стенд не поднимается — см. `global-setup`.
 */
export default defineConfig({
  testDir: './e2e',
  ...(OWNS_STACK ? { globalSetup: './e2e/support/global-setup.ts' } : {}),

  /*
   * Один воркер осознанно. API в стенде — строго один процесс, а состояние
   * оркестратора живёт в его памяти; параллельные прогоны делили бы один семафор
   * конкурентности и мешали бы друг другу по таймингам, а не по данным.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Редактор рассчитан от 1280px, и на холст нужно место: две ветки
        // ветвления должны помещаться в него целиком.
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
})
