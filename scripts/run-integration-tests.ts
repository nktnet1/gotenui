import { styleText } from 'node:util'
import { spawnVitest, type TestProcessResult } from '#scripts/test-process'

export const GOTENBERG_INTEGRATION_VERSIONS = ['8.40.0', '9.4.1'] as const
export type GotenbergIntegrationVersion = (typeof GOTENBERG_INTEGRATION_VERSIONS)[number]

export function integrationVersions(
  requested?: string,
  environment?: string,
): GotenbergIntegrationVersion[] {
  if (requested && environment && requested !== environment) {
    throw new Error(
      `Conflicting Gotenberg test versions: argument ${requested} and GOTENBERG_TEST_VERSION=${environment}.`,
    )
  }
  const version = requested || environment
  if (!version) return [...GOTENBERG_INTEGRATION_VERSIONS]
  if (!GOTENBERG_INTEGRATION_VERSIONS.some((candidate) => candidate === version)) {
    throw new Error('Integration tests require Gotenberg 8.40.0 or 9.4.1.')
  }
  return [version as GotenbergIntegrationVersion]
}

type RunVersion = (
  version: GotenbergIntegrationVersion,
) => TestProcessResult | Promise<TestProcessResult>

function runVitest(version: GotenbergIntegrationVersion): Promise<TestProcessResult> {
  return spawnVitest('vitest.integration.config.ts', version === '8.40.0' ? 'v8' : 'v9', {
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
      const label = styleText('cyan', version === '8.40.0' ? '[v8]' : '[v9]')
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
