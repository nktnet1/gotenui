import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import {
  type GotenbergIntegrationVersion,
  integrationVersions,
  runIntegrationMatrix,
} from '#scripts/run-integration-tests'

test('local integration runs pinned v8 and latest v9 images by default', () => {
  assert.deepEqual(integrationVersions(), ['8.40.0', '9.5.0'])
  assert.deepEqual(integrationVersions('9.5.0'), ['9.5.0'])
  assert.deepEqual(integrationVersions(undefined, '8.40.0'), ['8.40.0'])
})

test('integration runner rejects unknown or conflicting versions', () => {
  assert.throws(() => integrationVersions('latest'), /8\.40\.0 or 9\.5\.0/)
  assert.throws(() => integrationVersions(undefined, '8.37.0'), /8\.40\.0 or 9\.5\.0/)
  assert.throws(() => integrationVersions('9.5.0', '8.40.0'), /Conflicting/)
})

test('both suites start concurrently before any completes', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const started: GotenbergIntegrationVersion[] = []
  const finish = new Map<GotenbergIntegrationVersion, (result: { status: number }) => void>()
  const matrix = runIntegrationMatrix(integrationVersions(), (version) => {
    started.push(version)
    return new Promise((resolve) => finish.set(version, resolve))
  })
  assert.deepEqual(started, ['8.40.0', '9.5.0'])
  finish.get('9.5.0')?.({ status: 0 })
  finish.get('8.40.0')?.({ status: 0 })
  assert.equal(await matrix, 0)
})

test('a failed suite does not prevent the other versions from completing', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: GotenbergIntegrationVersion[] = []
  const result = await runIntegrationMatrix(integrationVersions(), (version) => {
    executed.push(version)
    return { status: version === '8.40.0' ? 1 : 0 }
  })
  assert.equal(result, 1)
  assert.deepEqual(executed, ['8.40.0', '9.5.0'])
})

test('integration runner reports success only after both suites pass', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    await runIntegrationMatrix(integrationVersions(), (version) => {
      executed.push(version)
      return { status: 0 }
    }),
    0,
  )
  assert.deepEqual(executed, ['8.40.0', '9.5.0'])
})

test('an interrupted subprocess fails the matrix while the other suites complete', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    await runIntegrationMatrix(integrationVersions(), (version) => {
      executed.push(version)
      return version === '8.40.0' ? { status: null, signal: 'SIGINT' } : { status: 0 }
    }),
    1,
  )
  assert.deepEqual(executed, ['8.40.0', '9.5.0'])
})

test('an integration runner exception is reported without cancelling the other suites', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    await runIntegrationMatrix(integrationVersions(), async (version) => {
      executed.push(version)
      if (version === '8.40.0') throw new Error('Could not launch Docker')
      return { status: 0 }
    }),
    1,
  )
  assert.deepEqual(executed, ['8.40.0', '9.5.0'])
})
