import { defineConfig } from 'vitest/config'
import { isHistoricalIntegrationVersion } from '#scripts/gotenberg-test-versions'
import { integrationTestCache } from '#scripts/test-cache'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    fsModuleCache: true,
    fsModuleCachePath: integrationTestCache(process.env.GOTENBERG_TEST_VERSION),
    isolate: true,
    environment: 'node',
    include: isHistoricalIntegrationVersion(process.env.GOTENBERG_TEST_VERSION)
      ? ['tests/integration/compatibility.integration.test.ts']
      : ['tests/integration/*.integration.test.ts'],
    globalSetup: ['./tests/integration/docker.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 150_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
})
