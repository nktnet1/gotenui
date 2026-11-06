import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { runTestSuites, TEST_SUITES, type TestSuite } from '#scripts/run-tests'

const quiet = () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

test('top-level runner starts unit and both Docker suites at the same time', async () => {
  quiet()
  assert.deepEqual(TEST_SUITES, ['unit', 'integration'])
  const started: TestSuite[] = []
  const finish = new Map<TestSuite, (value: { status: number }) => void>()
  const run = runTestSuites((suite) => {
    started.push(suite)
    return new Promise((resolve) => finish.set(suite, resolve))
  })
  assert.deepEqual(started, ['unit', 'integration'])
  finish.get('integration')?.({ status: 0 })
  finish.get('unit')?.({ status: 0 })
  assert.equal(await run, 0)
})

test('top-level runner waits for both failures and reports them', async () => {
  quiet()
  const started: TestSuite[] = []
  assert.equal(
    await runTestSuites((suite) => {
      started.push(suite)
      return { status: suite === 'unit' ? 0 : 1 }
    }),
    1,
  )
  assert.deepEqual(started, ['unit', 'integration'])
})

test('top-level runner handles signals, launch errors and rejected suites', async () => {
  quiet()
  assert.equal(
    await runTestSuites((suite) =>
      suite === 'unit' ? { status: 0, signal: 'SIGTERM' } : { status: 0 },
    ),
    1,
  )
  assert.equal(
    await runTestSuites((suite) =>
      suite === 'unit'
        ? { status: null, error: new Error('Vitest missing') }
        : Promise.reject(new Error('Docker missing')),
    ),
    1,
  )
})

test('resource-constrained machines can run unit then integration sequentially', async () => {
  quiet()
  const started: TestSuite[] = []
  const finish = new Map<TestSuite, (value: { status: number }) => void>()
  const run = runTestSuites((suite) => {
    started.push(suite)
    return new Promise((resolve) => finish.set(suite, resolve))
  }, false)
  assert.deepEqual(started, ['unit'])
  finish.get('unit')?.({ status: 0 })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(started, ['unit', 'integration'])
  finish.get('integration')?.({ status: 0 })
  assert.equal(await run, 0)
})

test('sequential mode still runs integration if the unit suite fails', async () => {
  quiet()
  const started: TestSuite[] = []
  assert.equal(
    await runTestSuites((suite) => {
      started.push(suite)
      return { status: suite === 'unit' ? 1 : 0 }
    }, false),
    1,
  )
  assert.deepEqual(started, ['unit', 'integration'])
})
