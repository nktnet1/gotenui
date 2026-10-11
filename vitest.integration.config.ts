import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    fsModuleCache: true,
    isolate: true,
    environment: 'node',
    include: ['tests/integration/*.integration.test.ts'],
    globalSetup: ['./tests/integration/docker.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 150_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
})
