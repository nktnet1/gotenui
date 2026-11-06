/** Each concurrent Vitest process owns its persistent transform cache. */
export const UNIT_TEST_CACHE = 'node_modules/.vitest-cache-unit'

export function integrationTestCache(version: string | undefined): string {
  return version === '9.1.0'
    ? 'node_modules/.vitest-cache-v91'
    : version === '9.0.0'
      ? 'node_modules/.vitest-cache-v9'
      : 'node_modules/.vitest-cache-v8'
}
