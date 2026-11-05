import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

export const GOTENBERG_INTEGRATION_VERSIONS = ['8.40.0', '9.0.0'] as const
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
    throw new Error('Integration tests require Gotenberg 8.40.0 or 9.0.0.')
  }
  return [version as GotenbergIntegrationVersion]
}

type IntegrationResult = {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

type RunVersion = (version: GotenbergIntegrationVersion) => IntegrationResult

function runVitest(version: GotenbergIntegrationVersion): IntegrationResult {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  return spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts'], {
    cwd: root,
    env: { ...process.env, GOTENBERG_TEST_VERSION: version },
    stdio: 'inherit',
  })
}

export function runIntegrationMatrix(
  versions: readonly GotenbergIntegrationVersion[],
  runVersion: RunVersion = runVitest,
): number {
  const failed: GotenbergIntegrationVersion[] = []
  for (const version of versions) {
    console.info(`\nRunning integration tests with ${styleText('cyan', `Gotenberg ${version}`)}...`)
    const result = runVersion(version)
    if (result.status === 0 && !result.error && !result.signal) {
      console.info(`${styleText('green', 'Passed')}: Gotenberg ${version}`)
      continue
    }
    failed.push(version)
    console.error(
      `${styleText('red', 'Failed')}: Gotenberg ${version}` +
        (result.error ? ` (${result.error.message})` : '') +
        (result.signal ? ` (signal ${result.signal})` : ''),
    )
    if (result.signal) break
  }

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
    process.exitCode = runIntegrationMatrix(
      integrationVersions(process.argv[2], process.env.GOTENBERG_TEST_VERSION),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
