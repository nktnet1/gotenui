import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { getGotenbergMetrics } from '#/lib/gotenberg-client'
import { proxyErrorResponse, proxyMetricsRequest } from '#/lib/gotenberg-proxy.server'
import {
  filterPrometheusMetrics,
  isPrometheusMetrics,
  summarizePrometheusMetrics,
} from '#/lib/prometheus-metrics'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'
const adminKey = 'local-metrics-unit-test-access-key-123456'
const text = [
  '# HELP gotenberg_requests_total Number of requests',
  '# TYPE gotenberg_requests_total counter',
  'gotenberg_requests_total{status="ok"} 4',
  '# HELP go_goroutines Number of goroutines',
  '# TYPE go_goroutines gauge',
  'go_goroutines 10',
  '',
].join('\n')

function metricsRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${origin}/api/gotenberg/metrics`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Gotenberg-Url': backend,
      'X-Gotenui-Debug-Access-Key': adminKey,
      ...headers,
    },
  })
}

const metricsResponse = () =>
  new Response(text, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Set-Cookie': 'upstream=secret',
    },
  })

beforeEach(() => {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend)
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', adminKey)
})
afterEach(() => vi.unstubAllEnvs())

test('legacy Prometheus metrics are recognised, summarized and filtered', () => {
  assert.equal(isPrometheusMetrics(text), true)
  assert.equal(isPrometheusMetrics('<html>Fallback</html>'), false)
  assert.equal(isPrometheusMetrics('just text'), false)
  assert.deepEqual(summarizePrometheusMetrics(text), { families: 2, samples: 2 })
  assert.match(filterPrometheusMetrics(text, 'GOROUTINES'), /go_goroutines 10/)
  assert.doesNotMatch(filterPrometheusMetrics(text, 'GOROUTINES'), /gotenberg_requests/)
  assert.equal(filterPrometheusMetrics(text, '  '), text)
})

test('metrics require a configured admin key, same origin, and POST before contacting Gotenberg', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls++
    return metricsResponse()
  }
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', undefined)
  await assert.rejects(
    proxyMetricsRequest(metricsRequest(), fetcher),
    (error: { status?: number }) => error.status === 404,
  )
  vi.stubEnv('GOTENUI_DEBUG_ACCESS_KEY', adminKey)
  await assert.rejects(
    proxyMetricsRequest(metricsRequest({ 'X-Gotenui-Debug-Access-Key': 'incorrect' }), fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  await assert.rejects(
    proxyMetricsRequest(metricsRequest({ Origin: 'https://untrusted.test' }), fetcher),
    (error: { status?: number }) => error.status === 403,
  )
  await assert.rejects(
    proxyMetricsRequest(new Request(`${origin}/api/gotenberg/metrics`), fetcher),
    (error: { status?: number }) => error.status === 405,
  )
  assert.equal(calls, 0)
})

test('metrics proxy uses approved target with no redirects and strips upstream headers', async () => {
  const request = metricsRequest({ Authorization: 'Bearer forged' })
  const response = await proxyMetricsRequest(request, async (input, options) => {
    assert.equal(String(input), `${backend}/prometheus/metrics`)
    assert.equal(options?.method, 'GET')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.credentials, 'omit')
    const forwarded = new Headers(options?.headers)
    assert.equal(forwarded.has('authorization'), false)
    assert.equal(forwarded.has('x-gotenui-debug-access-key'), false)
    return metricsResponse()
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-gotenui-metrics'), '1')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal(await response.text(), text)

  const unknown = metricsRequest({ 'X-Gotenberg-Url': 'https://unknown.example.test' })
  await assert.rejects(
    proxyMetricsRequest(unknown),
    (error: { status?: number }) => error.status === 403,
  )
})

test('server-managed profile credentials require its access key and cannot be overridden', async () => {
  const profileKey = 'local-unit-profile-key-1234567890'
  vi.stubEnv('GOTENUI_PROFILE_ACCESS_KEY', profileKey)
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'private',
        name: 'Private',
        url: backend,
        auth: { type: 'basic', username: 'metrics-user', password: 'metrics-password' },
      },
    ]),
  )
  const headers = {
    'X-Gotenberg-Url': '',
    'X-Gotenui-Connection-Id': 'private',
    'X-Gotenui-Profile-Access-Key': profileKey,
  }
  const request = metricsRequest(headers)
  request.headers.delete('X-Gotenberg-Url')
  const response = await proxyMetricsRequest(request, async (input, options) => {
    assert.equal(String(input), `${backend}/prometheus/metrics`)
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      `Basic ${Buffer.from('metrics-user:metrics-password').toString('base64')}`,
    )
    return metricsResponse()
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('authorization'), null)
  const wrong = request.clone()
  wrong.headers.set('X-Gotenui-Profile-Access-Key', 'incorrect')
  await assert.rejects(
    proxyMetricsRequest(wrong),
    (error: { status?: number }) => error.status === 403,
  )
  const forged = request.clone()
  forged.headers.set('X-Gotenui-Upstream-Authorization', 'Bearer forged')
  await assert.rejects(proxyMetricsRequest(forged), /cannot override/)
})

test('upstream errors never expose the upstream response body or authentication challenge', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    const response = await proxyMetricsRequest(
      metricsRequest(),
      async () =>
        new Response('sensitive upstream details', {
          status,
          headers: { 'WWW-Authenticate': 'Basic realm="Private"' },
        }),
    )
    assert.equal(response.status, status)
    assert.equal(response.headers.get('www-authenticate'), null)
    assert.doesNotMatch(await response.text(), /sensitive upstream details/)
  }
})

test('oversized, malformed and unrelated metrics responses are rejected as gateway errors', async () => {
  const huge = `${text}${'a'.repeat(2_000_001)}`
  for (const response of [
    new Response(text, {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '2000001' },
    }),
    new Response(huge, { headers: { 'Content-Type': 'text/plain' } }),
    new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('not metrics', { headers: { 'Content-Type': 'text/plain' } }),
    new Response(new Uint8Array([0xff, 0xfe]), {
      headers: { 'Content-Type': 'text/plain' },
    }),
  ]) {
    const result = await proxyMetricsRequest(metricsRequest(), async () => response).catch(
      proxyErrorResponse,
    )
    assert.equal(result.status, 502)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
  }
})

test('browser fetches metrics only through the same-origin API, with no query-string secrets', async () => {
  const original = globalThis.fetch
  const key = 'memory-only-admin-key'
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/gotenberg/metrics')
    assert.equal(options?.method, 'POST')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.body, undefined)
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('x-gotenui-debug-access-key'), key)
    assert.equal(headers.get('x-gotenberg-url'), backend)
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain', 'X-Gotenui-Metrics': '1' },
    })
  }
  try {
    assert.equal(await getGotenbergMetrics(backend, key), text)
    globalThis.fetch = async () => new Response('<html>fallback</html>')
    await assert.rejects(getGotenbergMetrics(backend, key), /did not reach/)
    globalThis.fetch = async () => new Response('Metrics unavailable', { status: 403 })
    await assert.rejects(getGotenbergMetrics(backend, key), /Metrics unavailable/)
  } finally {
    globalThis.fetch = original
  }
})
