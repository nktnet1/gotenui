import { defineConfig } from 'vitest/config'
import { UNIT_TEST_CACHE } from '#scripts/test-cache'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    fsModuleCache: true,
    fsModuleCachePath: UNIT_TEST_CACHE,
    isolate: true,
    environment: 'node',
    include: ['tests/*.test.ts'],
    restoreMocks: true,
  },
})
