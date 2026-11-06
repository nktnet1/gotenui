import { styleText } from 'node:util'
import { spawnVitest, type TestProcessResult } from '#scripts/test-process'

export const TEST_SUITES = ['unit', 'v8', 'v9', 'v91'] as const
export type TestSuite = (typeof TEST_SUITES)[number]

type RunSuite = (suite: TestSuite) => TestProcessResult | Promise<TestProcessResult>

function spawnSuite(suite: TestSuite): Promise<TestProcessResult> {
  if (suite === 'unit') return spawnVitest('vitest.config.ts', 'unit')
  const version = suite === 'v8' ? '8.40.0' : suite === 'v9' ? '9.0.0' : '9.1.0'
  return spawnVitest('vitest.integration.config.ts', suite, {
    ...process.env,
    GOTENBERG_TEST_VERSION: version,
  })
}

/** Run four independently labelled suites, reporting every failure even in parallel mode. */
export async function runTestSuites(
  runSuite: RunSuite = spawnSuite,
  parallel = true,
): Promise<number> {
  const execute = async (suite: TestSuite): Promise<boolean> => {
    console.info(`${styleText('cyan', `[${suite}]`)} Starting tests...`)
    try {
      const result = await runSuite(suite)
      if (result.status === 0 && !result.error && !result.signal) {
        console.info(`${styleText('cyan', `[${suite}]`)} ${styleText('green', 'Passed')}`)
        return true
      }
      console.error(
        `${styleText('cyan', `[${suite}]`)} ${styleText('red', 'Failed')}` +
          (result.error ? ` (${result.error.message})` : '') +
          (result.signal ? ` (signal ${result.signal})` : ''),
      )
    } catch (error) {
      console.error(
        `${styleText('cyan', `[${suite}]`)} ${styleText('red', 'Failed')}: ${error instanceof Error ? error.message : String(error)}`,
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
    console.info('Unit and Gotenberg 8.40.0 / 9.0.0 / 9.1.0 integration tests passed.')
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
