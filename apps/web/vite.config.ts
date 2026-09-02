import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fromHere('./src'),
      // Контракты резолвятся из исходников, а не из dist: ни dev-сервер, ни сборка
      // не должны зависеть от того, собран ли пакет (см. docs/decisions.md).
      '@workflow/contracts': fromHere('../../packages/contracts/src/index.ts'),
      '@workflow/core': fromHere('../../packages/core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    /*
     * В сборке статику и API отдаёт один хост, поэтому базовый адрес API — `/api`.
     * В dev его же проксируем на локальный Fastify: иначе пришлось бы держать
     * второй базовый адрес и CORS только ради разработки.
     */
    proxy: {
      '/api': {
        target: process.env['VITE_API_PROXY'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
