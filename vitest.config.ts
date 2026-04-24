import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@accord-kit/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@accord-kit/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
      '@accord-kit/cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)),
    },
  },
  test: {
    root,
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
})
