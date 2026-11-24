/** The only pinned Gotenberg Docker versions used by local tests and CI. */
export const GOTENBERG_TEST_VERSIONS = {
  v8: '8.40.0',
  v9: '9.10.0',
} as const

export const GOTENBERG_INTEGRATION_VERSIONS = [
  GOTENBERG_TEST_VERSIONS.v8,
  GOTENBERG_TEST_VERSIONS.v9,
] as const

export type GotenbergIntegrationVersion = (typeof GOTENBERG_INTEGRATION_VERSIONS)[number]

/** Accept stable major-suite selectors or an explicitly pinned image version. */
export function integrationTestVersion(selection: string): GotenbergIntegrationVersion | undefined {
  if (selection === 'v8' || selection === 'v9') return GOTENBERG_TEST_VERSIONS[selection]
  return GOTENBERG_INTEGRATION_VERSIONS.find((version) => version === selection)
}
