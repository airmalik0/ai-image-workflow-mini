import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // тесты ядра ходят в исходники контрактов, а не в dist:
    // иначе на чистом клоне они падают, пока не собран @workflow/contracts
    alias: {
      '@workflow/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
    },
  },
})
