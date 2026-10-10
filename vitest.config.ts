import { defineConfig } from 'vitest/config'
import { sourceAliases } from '#scripts/aliases'

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    environment: 'node',
    include: ['tests/*.test.ts'],
    restoreMocks: true,
  },
})
