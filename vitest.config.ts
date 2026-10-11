import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    fsModuleCache: true,
    isolate: true,
    environment: 'node',
    include: ['tests/*.test.ts'],
    restoreMocks: true,
  },
})
