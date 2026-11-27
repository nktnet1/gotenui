import { describe, expect, it } from 'vitest'
import {
  GOTENBERG_COMPATIBILITY_VERSIONS,
  GOTENBERG_TEST_VERSIONS,
} from '#scripts/gotenberg-test-versions'
import { integrationTestCache, UNIT_TEST_CACHE } from '#scripts/test-cache'
import unitConfig from '../vitest.config'
import integrationConfig from '../vitest.integration.config'

describe('parallel Vitest module caches', () => {
  it('uses distinct persistent caches for the unit, v8 and v9 suites', () => {
    const paths = [
      UNIT_TEST_CACHE,
      integrationTestCache(GOTENBERG_TEST_VERSIONS.v8),
      integrationTestCache(GOTENBERG_TEST_VERSIONS.v9),
      ...GOTENBERG_COMPATIBILITY_VERSIONS.map(integrationTestCache),
    ]
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((path) => path.startsWith('node_modules/.vitest-cache-'))).toBe(true)
    expect(paths).not.toContain('node_modules/.vitest-cache')
  })

  it('wires the unit and integration configs to their own cache directories', () => {
    expect(unitConfig.test?.fsModuleCache).toBe(true)
    expect(unitConfig.test?.fsModuleCachePath).toBe(UNIT_TEST_CACHE)
    expect(integrationConfig.test?.fsModuleCache).toBe(true)
    expect(integrationConfig.test?.fsModuleCachePath).toBe(
      integrationTestCache(process.env.GOTENBERG_TEST_VERSION),
    )
  })

  it('defaults standalone integration runs to the v8 cache', () => {
    expect(integrationTestCache(undefined)).toBe(integrationTestCache(GOTENBERG_TEST_VERSIONS.v8))
  })
})
