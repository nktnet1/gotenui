/** The only pinned Gotenberg Docker versions used by local tests and CI. */
export const GOTENBERG_TEST_VERSIONS = {
  v8: '8.40.0',
  v9: '9.10.0',
} as const

export const GOTENBERG_FULL_INTEGRATION_VERSIONS = [
  GOTENBERG_TEST_VERSIONS.v8,
  GOTENBERG_TEST_VERSIONS.v9,
] as const

/** Historical releases around v8 feature boundaries and every prior v9 minor. */
export const GOTENBERG_COMPATIBILITY_VERSIONS = [
  '8.35.0',
  '8.36.0',
  '8.37.0',
  '8.38.0',
  '8.39.0',
  '9.0.0',
  '9.1.0',
  '9.2.0',
  '9.3.0',
  '9.4.0',
  '9.5.0',
  '9.6.0',
  '9.7.0',
  '9.8.0',
  '9.9.0',
] as const

export const GOTENBERG_INTEGRATION_VERSIONS = [
  ...GOTENBERG_FULL_INTEGRATION_VERSIONS,
  ...GOTENBERG_COMPATIBILITY_VERSIONS,
] as const

export function isHistoricalIntegrationVersion(version: string | undefined): boolean {
  return GOTENBERG_COMPATIBILITY_VERSIONS.some((pinned) => version === pinned)
}

export type GotenbergIntegrationVersion = (typeof GOTENBERG_INTEGRATION_VERSIONS)[number]

/** Accept stable major-suite selectors or an explicitly pinned image version. */
export function integrationTestVersion(selection: string): GotenbergIntegrationVersion | undefined {
  if (selection === 'v8' || selection === 'v9') return GOTENBERG_TEST_VERSIONS[selection]
  return GOTENBERG_INTEGRATION_VERSIONS.find((version) => version === selection)
}

if (import.meta.main) console.info(JSON.stringify(GOTENBERG_COMPATIBILITY_VERSIONS))
