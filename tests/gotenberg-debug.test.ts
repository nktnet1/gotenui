import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyDebugRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'
const debugKey = 'local-unit-test-debug-access-key-12345'

function debugRequest(url = backend, headers: Record<string, string> = {}): Request {
  return new Request(`${origin}/api/gotenberg/debug`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Gotenberg-Url': url,
      'X-Gotenui-Debug-Access-Key': debugKey,
      ...headers,
    },
  })
}

beforeEach(() => {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend)
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', debugKey)
})
afterEach(() => vi.unstubAllEnvs())

test('requires a separately configured administrator key before contacting any backend', async () => {
  let called = 0
  const fetcher: typeof fetch = async () => {
    called++
    return Response.json({ secrets: 'private' })
  }
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', undefined)
  await assert.rejects(
    proxyDebugRequest(debugRequest(), fetcher),
    (error: { status?: number }) => error.status === 404,
  )
  assert.equal(called, 0)
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', debugKey)
  const missing = debugRequest()
  missing.headers.delete('X-Gotenui-Debug-Access-Key')
  await assert.rejects(
    proxyDebugRequest(missing, fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  const incorrect = debugRequest(backend, { 'X-Gotenui-Debug-Access-Key': 'wrong-secret' })
  await assert.rejects(
    proxyDebugRequest(incorrect, fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  assert.equal(called, 0)
})

test('admin key protects the exact allowlist and same-origin boundary', async () => {
  let called = false
  const fetcher: typeof fetch = async () => {
    called = true
    return Response.json({ ok: true })
  }
  await assert.rejects(
    proxyDebugRequest(debugRequest('https://unapproved.test'), fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  const crossOrigin = debugRequest(backend, { Origin: 'https://evil.example.test' })
  await assert.rejects(
    proxyDebugRequest(crossOrigin, fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  assert.equal(called, false)
})

test('debug returns bounded JSON with no-store and never forwards the admin key', async () => {
  const request = debugRequest()
  request.headers.set('Authorization', 'Bearer forged-browser-value')
  const response = await proxyDebugRequest(request, async (input, options) => {
    assert.equal(String(input), `${backend}/debug`)
    assert.equal(options?.method, 'GET')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.equal(new Headers(options?.headers).get('authorization'), null)
    assert.equal(new Headers(options?.headers).get('x-gotenui-debug-access-key'), null)
    return Response.json(
      { api: { enableDebugRoute: true }, runtime: { architecture: 'amd64' } },
      { headers: { 'set-cookie': 'should-not-reach-the-browser' } },
    )
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.deepEqual(await response.json(), {
    api: { enableDebugRoute: true },
    runtime: { architecture: 'amd64' },
  })
})

test('debug uses server-managed credentials only with a valid profile key', async () => {
  const profileKey = 'local-unit-test-profile-key-1234567'
  vi.stubEnv('GOTENUI_PROFILE_ACCESS_KEY', profileKey)
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'secure',
        name: 'Secured',
        url: backend,
        auth: { type: 'basic', username: 'debug-user', password: 'debug-password' },
      },
    ]),
  )
  const request = debugRequest()
  request.headers.delete('X-Gotenberg-Url')
  request.headers.set('X-Gotenui-Connection-Id', 'secure')
  request.headers.set('X-Gotenui-Profile-Access-Key', profileKey)
  const expected = `Basic ${Buffer.from('debug-user:debug-password').toString('base64')}`
  const response = await proxyDebugRequest(request, async (input, options) => {
    assert.equal(String(input), `${backend}/debug`)
    assert.equal(new Headers(options?.headers).get('authorization'), expected)
    return Response.json({ authenticated: true })
  })
  assert.equal(response.status, 200)
  const wrong = request.clone()
  wrong.headers.set('X-Gotenui-Profile-Access-Key', 'wrong')
  await assert.rejects(
    proxyDebugRequest(wrong),
    (error: { status?: number }) => error.status === 403,
  )
  const forged = request.clone()
  forged.headers.set('X-Gotenui-Upstream-Authorization', 'Bearer forged')
  await assert.rejects(proxyDebugRequest(forged), /cannot override/)
})

test('disabled upstream debug and upstream auth failures have safe messages', async () => {
  const disabled = await proxyDebugRequest(
    debugRequest(),
    async () => new Response('private stack trace', { status: 404 }),
  )
  assert.equal(disabled.status, 404)
  assert.match(await disabled.text(), /API_ENABLE_DEBUG_ROUTE/)
  const unauthorized = await proxyDebugRequest(
    debugRequest(),
    async () =>
      new Response('private details', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Gotenberg"' },
      }),
  )
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get('www-authenticate'), null)
  assert.doesNotMatch(await unauthorized.text(), /private details/)
})

test('invalid and oversized upstream responses cannot be relayed', async () => {
  for (const fake of [
    new Response('<html>not debug</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('not-json', { headers: { 'Content-Type': 'application/json' } }),
    Response.json(['not a debug object']),
    Response.json({ blob: 'x'.repeat(1_000_010) }),
  ]) {
    const error = await proxyDebugRequest(debugRequest(), async () => fake).catch(
      proxyErrorResponse,
    )
    assert.equal(error.status, 502)
    assert.equal(error.headers.get('cache-control'), 'no-store')
    assert.equal(error.headers.get('content-type'), 'text/plain; charset=utf-8')
  }
})
