import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import {
  type GotenbergIntegrationVersion,
  integrationVersions,
  runIntegrationMatrix,
} from '#scripts/run-integration-tests'

test('local integration runs both exact pinned versions by default', () => {
  assert.deepEqual(integrationVersions(), ['8.40.0', '9.0.0'])
  assert.deepEqual(integrationVersions('9.0.0'), ['9.0.0'])
  assert.deepEqual(integrationVersions(undefined, '8.40.0'), ['8.40.0'])
})

test('integration runner rejects unknown or conflicting versions', () => {
  assert.throws(() => integrationVersions('latest'), /8\.40\.0 or 9\.0\.0/)
  assert.throws(() => integrationVersions(undefined, '8.37.0'), /8\.40\.0 or 9\.0\.0/)
  assert.throws(() => integrationVersions('9.0.0', '8.40.0'), /Conflicting/)
})

test('both integration suites run and failures are propagated without hiding the other version', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: GotenbergIntegrationVersion[] = []
  const result = runIntegrationMatrix(integrationVersions(), (version) => {
    executed.push(version)
    return { status: version === '8.40.0' ? 1 : 0 }
  })
  assert.equal(result, 1)
  assert.deepEqual(executed, ['8.40.0', '9.0.0'])
})

test('integration runner reports success only after both suites pass', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    runIntegrationMatrix(integrationVersions(), (version) => {
      executed.push(version)
      return { status: 0 }
    }),
    0,
  )
  assert.deepEqual(executed, ['8.40.0', '9.0.0'])
})

test('integration runner stops on an interrupted subprocess', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let runs = 0
  assert.equal(
    runIntegrationMatrix(integrationVersions(), () => {
      runs++
      return { status: null, signal: 'SIGINT' }
    }),
    1,
  )
  assert.equal(runs, 1)
})
