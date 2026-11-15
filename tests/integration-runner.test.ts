import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, vi } from 'vitest'
import { GOTENBERG_TEST_VERSIONS } from '#scripts/gotenberg-test-versions'
import {
  type GotenbergIntegrationVersion,
  integrationVersions,
  runIntegrationMatrix,
} from '#scripts/run-integration-tests'

const { v8, v9 } = GOTENBERG_TEST_VERSIONS

const pinnedVersions = [v8, v9]

test('local integration runs pinned v8 and latest v9 images by default', () => {
  assert.deepEqual(integrationVersions(), pinnedVersions)
  assert.deepEqual(integrationVersions(v9), [v9])
  assert.deepEqual(integrationVersions(undefined, v8), [v8])
  assert.deepEqual(integrationVersions('v8'), [v8])
  assert.deepEqual(integrationVersions('v9'), [v9])
  assert.deepEqual(integrationVersions('v8', v8), [v8])
})

test('shared pins are valid, unique versions for their respective major suites', () => {
  assert.match(v8, /^8\.\d+\.\d+$/)
  assert.match(v9, /^9\.\d+\.\d+$/)
  assert.notEqual(v8, v9)
})

test('CI and package commands select named suites without duplicating version pins', () => {
  const root = new URL('../', import.meta.url)
  const ci = readFileSync(new URL('.github/workflows/ci.yaml', root), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  assert.match(ci, /suite: \[v8, v9\]/)
  assert.match(ci, /run: pnpm test:integration:\$\{\{ matrix\.suite \}\}/)
  assert.equal(pkg.scripts['test:integration:v8'], 'node scripts/run-integration-tests.ts v8')
  assert.equal(pkg.scripts['test:integration:v9'], 'node scripts/run-integration-tests.ts v9')
  assert.doesNotMatch(ci, /gotenberg-version:/)
})

test('integration runner rejects unknown or conflicting versions', () => {
  for (const selection of ['latest', '8.37.0', '9.999.999']) {
    assert.throws(() => integrationVersions(selection), /Integration tests require Gotenberg/)
  }
  assert.throws(() => integrationVersions('v9', v8), /Conflicting/)
  assert.throws(() => integrationVersions(v9, 'v8'), /Conflicting/)
})

test('both suites start concurrently before any completes', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const started: GotenbergIntegrationVersion[] = []
  const finish = new Map<GotenbergIntegrationVersion, (result: { status: number }) => void>()
  const matrix = runIntegrationMatrix(integrationVersions(), (version) => {
    started.push(version)
    return new Promise((resolve) => finish.set(version, resolve))
  })
  assert.deepEqual(started, pinnedVersions)
  finish.get(v9)?.({ status: 0 })
  finish.get(v8)?.({ status: 0 })
  assert.equal(await matrix, 0)
})

test('a failed suite does not prevent the other versions from completing', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: GotenbergIntegrationVersion[] = []
  const result = await runIntegrationMatrix(integrationVersions(), (version) => {
    executed.push(version)
    return { status: version === v8 ? 1 : 0 }
  })
  assert.equal(result, 1)
  assert.deepEqual(executed, pinnedVersions)
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
  assert.deepEqual(executed, pinnedVersions)
})

test('an interrupted subprocess fails the matrix while the other suites complete', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    await runIntegrationMatrix(integrationVersions(), (version) => {
      executed.push(version)
      return version === v8 ? { status: null, signal: 'SIGINT' } : { status: 0 }
    }),
    1,
  )
  assert.deepEqual(executed, pinnedVersions)
})

test('an integration runner exception is reported without cancelling the other suites', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const executed: string[] = []
  assert.equal(
    await runIntegrationMatrix(integrationVersions(), async (version) => {
      executed.push(version)
      if (version === v8) throw new Error('Could not launch Docker')
      return { status: 0 }
    }),
    1,
  )
  assert.deepEqual(executed, pinnedVersions)
})
