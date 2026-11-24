import { styleText } from 'node:util'
import {
  GOTENBERG_FULL_INTEGRATION_VERSIONS,
  GOTENBERG_INTEGRATION_VERSIONS,
  GOTENBERG_TEST_VERSIONS,
  type GotenbergIntegrationVersion,
  integrationTestVersion,
} from '#scripts/gotenberg-test-versions'
import { spawnVitest, type TestProcessResult } from '#scripts/test-process'

export type { GotenbergIntegrationVersion } from '#scripts/gotenberg-test-versions'
export { GOTENBERG_INTEGRATION_VERSIONS } from '#scripts/gotenberg-test-versions'

export function integrationVersions(
  requested?: string,
  environment?: string,
): GotenbergIntegrationVersion[] {
  const version = requested || environment
  if (!version) return [...GOTENBERG_FULL_INTEGRATION_VERSIONS]
  const selected = integrationTestVersion(version)
  if (!selected) {
    throw new Error(
      `Integration tests require Gotenberg ${GOTENBERG_INTEGRATION_VERSIONS.join(' or ')} (or v8/v9).`,
    )
  }
  if (requested && environment && selected !== integrationTestVersion(environment)) {
    throw new Error(
      `Conflicting Gotenberg test versions: argument ${requested} and GOTENBERG_TEST_VERSION=${environment}.`,
    )
  }
  return [selected]
}

type RunVersion = (
  version: GotenbergIntegrationVersion,
) => TestProcessResult | Promise<TestProcessResult>

function versionLabel(version: GotenbergIntegrationVersion) {
  if (version === GOTENBERG_TEST_VERSIONS.v8) return 'v8'
  if (version === GOTENBERG_TEST_VERSIONS.v9) return 'v9'
  return version
}

function runVitest(version: GotenbergIntegrationVersion): Promise<TestProcessResult> {
  return spawnVitest('vitest.integration.config.ts', versionLabel(version), {
    ...process.env,
    GOTENBERG_TEST_VERSION: version,
  })
}

/** Run separate Vitest processes concurrently; each provisions its own Docker container and fixture. */
export async function runIntegrationMatrix(
  versions: readonly GotenbergIntegrationVersion[],
  runVersion: RunVersion = runVitest,
): Promise<number> {
  const outcomes = await Promise.all(
    versions.map(async (version) => {
      const label = styleText('cyan', `[${versionLabel(version)}]`)
      console.info(`\n${label} Starting Gotenberg ${version} integration tests...`)
      try {
        const result = await runVersion(version)
        if (result.status === 0 && !result.error && !result.signal) {
          console.info(`${label} ${styleText('green', 'Passed')}: Gotenberg ${version}`)
          return { version, passed: true }
        }
        console.error(
          `${label} ${styleText('red', 'Failed')}: Gotenberg ${version}` +
            (result.error ? ` (${result.error.message})` : '') +
            (result.signal ? ` (signal ${result.signal})` : ''),
        )
      } catch (error) {
        console.error(
          `${label} ${styleText('red', 'Failed')}: Gotenberg ${version} (${error instanceof Error ? error.message : String(error)})`,
        )
      }
      return { version, passed: false }
    }),
  )

  const failed = outcomes.filter(({ passed }) => !passed).map(({ version }) => version)
  if (failed.length > 0) {
    console.error(`Integration failures: ${failed.join(', ')}`)
    return 1
  }
  console.info(
    `Integration tests passed for ${versions.map((version) => `Gotenberg ${version}`).join(' and ')}.`,
  )
  return 0
}

if (import.meta.main) {
  try {
    if (process.argv.length > 3) throw new Error('Provide at most one Gotenberg version.')
    process.exitCode = await runIntegrationMatrix(
      integrationVersions(process.argv[2], process.env.GOTENBERG_TEST_VERSION),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
