import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { fetchConnectionSettings } from '#/lib/connection-profiles'
import {
  proxyConnectionsRequest,
  proxyDebugRequest,
  proxyMetricsRequest,
} from '#/lib/gotenberg-proxy.server'
import { uiFeatures } from '#/lib/ui-features.server'

const origin = 'https://gotenui.example.test'

afterEach(() => vi.unstubAllEnvs())

test('visibility defaults on, is configurable at runtime, and validates env values', () => {
  assert.deepEqual(uiFeatures({}), { showDebug: true, showMetrics: true })
  assert.deepEqual(uiFeatures({ GOTENUI_SHOW_DEBUG: 'false', GOTENUI_SHOW_METRICS: 'true' }), {
    showDebug: false,
    showMetrics: true,
  })
  assert.deepEqual(uiFeatures({ GOTENUI_SHOW_DEBUG: 'true', GOTENUI_SHOW_METRICS: 'false' }), {
    showDebug: true,
    showMetrics: false,
  })
  assert.throws(() => uiFeatures({ GOTENUI_SHOW_DEBUG: 'nope' }), /GOTENUI_SHOW_DEBUG/)
})

test('connection metadata includes only public profile names and visibility choices', async () => {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', 'https://pdf.example.test')
  vi.stubEnv('GOTENUI_SHOW_DEBUG', 'false')
  vi.stubEnv('GOTENUI_SHOW_METRICS', 'true')
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'private',
        name: 'Private',
        url: 'https://pdf.example.test',
        auth: { type: 'bearer', token: 'server-secret-value' },
      },
    ]),
  )
  const response = proxyConnectionsRequest(new Request(`${origin}/api/gotenberg/connections`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.text()
  assert.deepEqual(JSON.parse(body), {
    connections: [{ id: 'private', name: 'Private' }],
    features: { showDebug: false, showMetrics: true },
  })
  assert.doesNotMatch(body, /server-secret-value|pdf\.example\.test/)
})

test('browser reads runtime flags from the same-origin connections endpoint', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/gotenberg/connections')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.credentials, 'same-origin')
    return Response.json({ connections: [], features: { showDebug: false, showMetrics: true } })
  }
  try {
    assert.deepEqual(await fetchConnectionSettings(), {
      connections: [],
      features: { showDebug: false, showMetrics: true },
    })
  } finally {
    globalThis.fetch = original
  }
})

test('hidden diagnostic controls never act as authorisation for the proxy API', async () => {
  const backend = 'http://127.0.0.1:3000'
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend)
  vi.stubEnv('GOTENUI_SHOW_DEBUG', 'false')
  vi.stubEnv('GOTENUI_SHOW_METRICS', 'false')
  const debug = await proxyDebugRequest(
    new Request(`${origin}/api/gotenberg/debug`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenberg-Url': backend },
    }),
    async () => Response.json({ debug: true }),
  )
  assert.equal(debug.status, 200)
  const metrics = await proxyMetricsRequest(
    new Request(`${origin}/api/gotenberg/metrics`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenberg-Url': backend },
    }),
    async () =>
      new Response(
        '# HELP gotenberg_requests_total Requests\n# TYPE gotenberg_requests_total counter\ngotenberg_requests_total 1\n',
        {
          headers: { 'Content-Type': 'text/plain' },
        },
      ),
  )
  assert.equal(metrics.status, 200)
})
