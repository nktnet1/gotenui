import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyHeadErrorResponse, proxyHeadHealthRequest } from '#/lib/gotenberg-proxy.server'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'

function headRequest(path = `?url=${encodeURIComponent(backend)}`, headers: HeadersInit = {}) {
  return new Request(`${origin}/api/gotenberg/health${path}`, {
    method: 'HEAD',
    headers: { Origin: origin, ...Object.fromEntries(new Headers(headers)) },
  })
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

test.each([200, 503])(
  'HEAD health preserves Gotenberg %i without a response body',
  async (code) => {
    let called = 0
    const response = await proxyHeadHealthRequest(headRequest(), async (input, options) => {
      called++
      assert.equal(String(input), `${backend}/health`)
      assert.equal(options?.method, 'HEAD')
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.cache, 'no-store')
      assert.equal(options?.credentials, 'omit')
      assert.equal(new Headers(options?.headers).get('authorization'), null)
      return new Response(null, {
        status: code,
        headers: { 'set-cookie': 'never-include-me=1', 'x-upstream-internal': 'secret' },
      })
    })
    assert.equal(called, 1)
    assert.equal(response.status, code)
    assert.equal(await response.text(), '')
    assert.equal(response.body, null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-gotenui-health-probe'), '1')
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('x-upstream-internal'), null)
  },
)

test('HEAD health uses the selected server profile and attaches only upstream credentials', async () => {
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'private',
        name: 'Private',
        url: backend,
        auth: { type: 'basic', username: 'test-user', password: 'test-password' },
      },
    ]),
  )
  const expected = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`
  const request = headRequest('?connection=private')
  const response = await proxyHeadHealthRequest(request, async (input, options) => {
    assert.equal(String(input), `${backend}/health`)
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('authorization'), expected)
    assert.equal(headers.get('x-gotenui-profile-access-key'), null)
    return new Response(null, { status: 200 })
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('authorization'), null)
  assert.equal(response.body, null)

  const forged = headRequest('?connection=private', {
    'X-Gotenui-Upstream-Authorization': 'Bearer forged',
  })
  await assert.rejects(proxyHeadHealthRequest(forged), /cannot override/)
})

test('HEAD health enforces allowlisting, same-origin and method restrictions', async () => {
  const unauthorized = headRequest('?url=https%3A%2F%2Fevil.test')
  await assert.rejects(
    proxyHeadHealthRequest(unauthorized),
    (error: { status?: number }) => error.status === 403,
  )
  const crossOrigin = headRequest()
  crossOrigin.headers.set('origin', 'https://evil.test')
  await assert.rejects(
    proxyHeadHealthRequest(crossOrigin),
    (error: { status?: number }) => error.status === 403,
  )
  await assert.rejects(
    proxyHeadHealthRequest(new Request(`${origin}/api/gotenberg/health?url=${backend}`)),
    (error: { status?: number }) => error.status === 405,
  )
})

test('HEAD error path remains bodyless for rejected URLs and upstream failures', async () => {
  const rejected = await proxyHeadHealthRequest(headRequest('?url=https%3A%2F%2Fevil.test')).catch(
    proxyHeadErrorResponse,
  )
  assert.equal(rejected.status, 403)
  assert.equal(rejected.body, null)
  assert.equal(await rejected.text(), '')
  assert.equal(rejected.headers.get('content-type'), null)
  assert.equal(rejected.headers.get('x-gotenui-health-probe'), '1')

  const failed = await proxyHeadHealthRequest(headRequest(), async () => {
    throw new Error('network failure')
  }).catch(proxyHeadErrorResponse)
  assert.equal(failed.status, 502)
  assert.equal(failed.body, null)
  assert.equal(failed.headers.get('cache-control'), 'no-store')
  assert.equal(await failed.text(), '')
})

test('unexpected upstream status is a gateway failure, never a false positive', async () => {
  const response = await proxyHeadHealthRequest(
    headRequest(),
    async () => new Response(null, { status: 204 }),
  )
  assert.equal(response.status, 502)
  assert.equal(response.body, null)

  const authRejected = await proxyHeadHealthRequest(
    headRequest(),
    async () => new Response(null, { status: 401 }),
  )
  assert.equal(authRejected.status, 401)
  assert.equal(authRejected.body, null)
})
