import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

export const TEST_SUITES = ['unit', 'integration'] as const
export type TestSuite = (typeof TEST_SUITES)[number]

type SuiteResult = {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

type RunSuite = (suite: TestSuite) => SuiteResult | Promise<SuiteResult>

function spawnSuite(suite: TestSuite): Promise<SuiteResult> {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const script = fileURLToPath(
    new URL(
      suite === 'unit' ? '../node_modules/vitest/vitest.mjs' : './run-integration-tests.ts',
      import.meta.url,
    ),
  )
  const args = suite === 'unit' ? [script, 'run', '--config', 'vitest.config.ts'] : [script]
  return new Promise((resolve) => {
    let error: Error | undefined
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      // Preserve Vitest output and Docker image pull progress in real time.
      stdio: 'inherit',
    })
    child.once('error', (cause) => {
      error = cause
    })
    child.once('close', (status, signal) => resolve({ status, signal, error }))
  })
}

/** Run unit tests and both isolated Docker suites concurrently, without losing failures. */
export async function runTestSuites(
  runSuite: RunSuite = spawnSuite,
  parallel = true,
): Promise<number> {
  const execute = async (suite: TestSuite): Promise<boolean> => {
    console.info(`Starting ${styleText('cyan', suite)} tests...`)
    try {
      const result = await runSuite(suite)
      if (result.status === 0 && !result.error && !result.signal) {
        console.info(`${styleText('green', 'Passed')}: ${suite} tests`)
        return true
      }
      console.error(
        `${styleText('red', 'Failed')}: ${suite} tests` +
          (result.error ? ` (${result.error.message})` : '') +
          (result.signal ? ` (signal ${result.signal})` : ''),
      )
    } catch (error) {
      console.error(
        `${styleText('red', 'Failed')}: ${suite} tests (${error instanceof Error ? error.message : String(error)})`,
      )
    }
    return false
  }
  const passed = parallel
    ? await Promise.all(TEST_SUITES.map(execute))
    : await (async () => {
        const results: boolean[] = []
        for (const suite of TEST_SUITES) results.push(await execute(suite))
        return results
      })()
  if (passed.every(Boolean)) {
    console.info('Unit and Gotenberg 8.40.0 / 9.0.0 integration tests passed.')
    return 0
  }
  console.error(
    `Failed test suites: ${TEST_SUITES.filter((_, index) => !passed[index]).join(', ')}`,
  )
  return 1
}

if (import.meta.main) {
  process.exitCode = await runTestSuites(undefined, process.env.GOTENUI_TEST_SEQUENTIAL !== '1')
}
