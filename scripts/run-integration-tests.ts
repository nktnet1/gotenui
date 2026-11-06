import { spawn } from 'node:child_process'
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

type RunVersion = (
  version: GotenbergIntegrationVersion,
) => IntegrationResult | Promise<IntegrationResult>

function runVitest(version: GotenbergIntegrationVersion): Promise<IntegrationResult> {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  return new Promise((resolve) => {
    let error: Error | undefined
    const child = spawn(
      process.execPath,
      [vitest, 'run', '--config', 'vitest.integration.config.ts'],
      {
        cwd: root,
        env: { ...process.env, GOTENBERG_TEST_VERSION: version },
        // Do not buffer Vitest or Docker pull output: both suites stream live.
        stdio: 'inherit',
      },
    )
    child.once('error', (cause) => {
      error = cause
    })
    child.once('close', (status, signal) => resolve({ status, signal, error }))
  })
}

/** Run separate Vitest processes concurrently; each provisions its own Docker container and fixture. */
export async function runIntegrationMatrix(
  versions: readonly GotenbergIntegrationVersion[],
  runVersion: RunVersion = runVitest,
): Promise<number> {
  const outcomes = await Promise.all(
    versions.map(async (version) => {
      console.info(
        `\nStarting integration tests with ${styleText('cyan', `Gotenberg ${version}`)}...`,
      )
      try {
        const result = await runVersion(version)
        if (result.status === 0 && !result.error && !result.signal) {
          console.info(`${styleText('green', 'Passed')}: Gotenberg ${version}`)
          return { version, passed: true }
        }
        console.error(
          `${styleText('red', 'Failed')}: Gotenberg ${version}` +
            (result.error ? ` (${result.error.message})` : '') +
            (result.signal ? ` (signal ${result.signal})` : ''),
        )
      } catch (error) {
        console.error(
          `${styleText('red', 'Failed')}: Gotenberg ${version} (${error instanceof Error ? error.message : String(error)})`,
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
