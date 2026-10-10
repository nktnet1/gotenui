import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEMO_GOTENBERG_URL,
  parseAllowedBackends,
  readLimitedBody,
  requireAllowedBackend,
  requireSameOrigin,
} from '#/lib/proxy-policy'

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

test('explicit public origin permits TLS-terminating reverse proxies without trusting forwarded headers', () => {
  const internalUrl = 'http://127.0.0.1:3100/api/gotenberg/convert'
  const publicOrigin = 'https://documents.example.test'
  const request = (origin: string, headers: Record<string, string> = {}) =>
    new Request(internalUrl, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        ...headers,
      },
    })

  assert.throws(() => requireSameOrigin(request(publicOrigin)), /Cross-origin/)
  requireSameOrigin(request(publicOrigin), publicOrigin)
  requireSameOrigin(request(publicOrigin), `${publicOrigin}/`)
  for (const origin of [
    'http://127.0.0.1:3100',
    'http://documents.example.test',
    'https://documents.example.test:8443',
    'https://documents.example.test.attacker.test',
    'null',
  ]) {
    assert.throws(
      () =>
        requireSameOrigin(
          request(origin, {
            'X-Forwarded-Host': 'documents.example.test',
            'X-Forwarded-Proto': 'https',
          }),
          publicOrigin,
        ),
      /Cross-origin/,
      origin,
    )
  }
  assert.throws(
    () =>
      requireSameOrigin(request(publicOrigin, { 'Sec-Fetch-Site': 'cross-site' }), publicOrigin),
    /Cross-origin/,
  )
})

test('the public origin setting accepts only an HTTP(S) origin without credentials or paths', () => {
  const request = new Request('http://127.0.0.1:3100/api/gotenberg/connections')
  for (const invalid of [
    '',
    'documents.example.test',
    'ftp://documents.example.test',
    'https://admin:secret@documents.example.test',
    'https://documents.example.test/proxy',
    'https://documents.example.test?redirect=1',
    'https://documents.example.test#anchor',
    'https://documents.example.test.attacker.test/path',
    'https://documents.example.test\nX-Foo: evil',
  ]) {
    assert.throws(() => requireSameOrigin(request, invalid), /GOTENUI_PUBLIC_ORIGIN/, invalid)
  }
  requireSameOrigin(request, 'http://127.0.0.1:3100')
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

test('waits for oversized body cancellation before rejecting with HTTP 413', async () => {
  let cancellationFinished = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2_000))
    },
    async cancel() {
      await new Promise((resolve) => setTimeout(resolve, 10))
      cancellationFinished = true
    },
  })
  await assert.rejects(
    readLimitedBody(body, 1_024),
    (error: { status?: number }) => error.status === 413,
  )
  assert.equal(cancellationFinished, true)
})
