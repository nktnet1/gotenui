import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEMO_GOTENBERG_URL,
  parseAllowedBackends,
  readLimitedBody,
  requireAllowedBackend,
  requireSameOrigin,
} from '../src/lib/proxy-policy.ts'

test('the only default proxy target is the public demo', () => {
  assert.equal(DEFAULT_MAX_REQUEST_BYTES, 4_200_000)
  assert.deepEqual([...parseAllowedBackends(undefined)], [DEMO_GOTENBERG_URL])
  assert.equal(
    requireAllowedBackend(`${DEMO_GOTENBERG_URL}/`, parseAllowedBackends(undefined)),
    DEMO_GOTENBERG_URL,
  )
})

test('the allowlist matches exact origins and optional base paths', () => {
  const allowed = parseAllowedBackends('https://demo.gotenberg.dev,https://files.test/proxy/')
  assert.equal(
    requireAllowedBackend('https://files.test/proxy', allowed),
    'https://files.test/proxy',
  )
  for (const value of [
    'https://demo.gotenberg.dev.evil.test',
    'http://demo.gotenberg.dev',
    'https://files.test',
    'https://files.test/proxy/admin',
    'https://files.test.evil.test/proxy',
    'http://169.254.169.254/latest/meta-data',
    'https://demo.gotenberg.dev@evil.test',
  ]) {
    assert.throws(() => requireAllowedBackend(value, allowed), /not approved|valid absolute/, value)
  }
  assert.throws(() => parseAllowedBackends(''), /must contain/)
})

test('same-origin browser requests pass; foreign origin and site are rejected', () => {
  const url = 'https://docs.example.test/api/gotenberg/convert'
  requireSameOrigin(new Request(url, { headers: { origin: 'https://docs.example.test' } }))
  assert.throws(
    () => requireSameOrigin(new Request(url, { headers: { origin: 'https://evil.test' } })),
    /Cross-origin/,
  )
  assert.throws(
    () => requireSameOrigin(new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } })),
    /Cross-origin/,
  )
})

test('reads bounded bodies and rejects oversized streams without buffering them', async () => {
  const good = new Blob(['a'.repeat(100)]).stream()
  const bytes = await readLimitedBody(good, 101)
  assert.equal(bytes.length, 100)
  const bad = new Blob(['a'.repeat(102)]).stream()
  await assert.rejects(
    readLimitedBody(bad, 101),
    (error: { status?: number }) => error.status === 413,
  )
  await assert.rejects(readLimitedBody(null, 101), /multipart request body/)
})
