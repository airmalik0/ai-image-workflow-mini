import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'worker',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // тесты ходят в исходники workspace-пакетов, а не в dist:
    // иначе на чистом клоне они падают, пока не собраны contracts, core и api
    alias: {
      '@workflow/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@workflow/core/testing': fileURLToPath(
        new URL('../../packages/core/src/testing/index.ts', import.meta.url),
      ),
      '@workflow/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@workflow/api/testing': fileURLToPath(
        new URL('../api/src/testing/index.ts', import.meta.url),
      ),
      '@workflow/api': fileURLToPath(new URL('../api/src/index.ts', import.meta.url)),
    },
  },
})
