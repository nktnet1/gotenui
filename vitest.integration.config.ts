import { defineConfig } from 'vitest/config'
import { sourceAliases } from '#scripts/aliases'

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    environment: 'node',
    include: ['tests/integration/*.integration.test.ts'],
    globalSetup: ['./tests/integration/docker.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 150_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
})
