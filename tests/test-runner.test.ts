import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { runTestSuites, TEST_SUITES, type TestSuite } from '#scripts/run-tests'

const quiet = () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

test('top-level runner starts unit and two pinned Docker suites at the same time', async () => {
  quiet()
  assert.deepEqual(TEST_SUITES, ['unit', 'v8', 'v9'])
  const started: TestSuite[] = []
  const finish = new Map<TestSuite, (value: { status: number }) => void>()
  const run = runTestSuites((suite) => {
    started.push(suite)
    return new Promise((resolve) => finish.set(suite, resolve))
  })
  assert.deepEqual(started, ['unit', 'v8', 'v9'])
  finish.get('v9')?.({ status: 0 })
  finish.get('unit')?.({ status: 0 })
  finish.get('v8')?.({ status: 0 })
  assert.equal(await run, 0)
})

test('top-level runner waits for all three outcomes and reports failed suites separately', async () => {
  quiet()
  const started: TestSuite[] = []
  assert.equal(
    await runTestSuites((suite) => {
      started.push(suite)
      return { status: suite === 'v8' ? 1 : 0 }
    }),
    1,
  )
  assert.deepEqual(started, ['unit', 'v8', 'v9'])
  assert.match(vi.mocked(console.error).mock.calls.flat().join(' '), /Failed test suites: v8/)
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
    await runTestSuites((suite) => {
      if (suite === 'unit') return { status: null, error: new Error('Vitest missing') }
      if (suite === 'v8') return Promise.reject(new Error('Docker missing'))
      return { status: 0 }
    }),
    1,
  )
})

test('resource-constrained machines can run unit, v8 and v9 sequentially', async () => {
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
  assert.deepEqual(started, ['unit', 'v8'])
  finish.get('v8')?.({ status: 0 })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(started, ['unit', 'v8', 'v9'])
  finish.get('v9')?.({ status: 0 })
  assert.equal(await run, 0)
})

test('sequential mode still runs both integrations if the unit suite fails', async () => {
  quiet()
  const started: TestSuite[] = []
  assert.equal(
    await runTestSuites((suite) => {
      started.push(suite)
      return { status: suite === 'unit' ? 1 : 0 }
    }, false),
    1,
  )
  assert.deepEqual(started, ['unit', 'v8', 'v9'])
})
