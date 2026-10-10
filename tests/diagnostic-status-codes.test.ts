import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  proxyDebugRequest,
  proxyErrorResponse,
  proxyMetricsRequest,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'
const health = JSON.stringify({ status: 'up', details: {} })
const metrics =
  '# HELP gotenberg_requests_total Count\n# TYPE gotenberg_requests_total counter\ngotenberg_requests_total 1\n'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

function request(route: 'status' | 'debug' | 'metrics'): Request {
  if (route === 'status') {
    return new Request(`${origin}/api/gotenberg/status?url=${encodeURIComponent(backend)}`, {
      headers: { Origin: origin },
    })
  }
  return new Request(`${origin}/api/gotenberg/${route}`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend },
  })
}

for (const status of [201, 206]) {
  test(`GET /health rejects a syntactically valid body with upstream HTTP ${status}`, async () => {
    const response = await proxyStatusRequest(request('status'), async (url) =>
      String(url).endsWith('/health')
        ? new Response(health, { status, headers: { 'Content-Type': 'application/json' } })
        : new Response('8.37.0'),
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json()).online, false)
  })

  test(`GET /version ignores a syntactically valid partial HTTP ${status} result`, async () => {
    const response = await proxyStatusRequest(request('status'), async (url) =>
      String(url).endsWith('/health')
        ? Response.json(JSON.parse(health))
        : new Response('8.37.0', { status }),
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { online: true, version: 'Unknown', modules: [] })
  })

  test(`GET /debug rejects JSON with upstream HTTP ${status}`, async () => {
    const response = await proxyDebugRequest(request('debug'), async () =>
      Response.json({ api: { enabled: true } }, { status }),
    ).catch(proxyErrorResponse)
    assert.equal(response.status, 502)
  })

  test(`GET /prometheus/metrics rejects well-formed metrics with upstream HTTP ${status}`, async () => {
    const response = await proxyMetricsRequest(
      request('metrics'),
      async () => new Response(metrics, { status, headers: { 'Content-Type': 'text/plain' } }),
    ).catch(proxyErrorResponse)
    assert.equal(response.status, 502)
  })
}

for (const route of ['health', 'version', 'debug', 'metrics'] as const) {
  test(`a rejected partial ${route} response cancels its unread body`, async () => {
    let cancelled = false
    const unreadBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel() {
        cancelled = true
      },
    })
    const upstream = new Response(unreadBody, {
      status: 206,
      headers: { 'Content-Type': route === 'metrics' ? 'text/plain' : 'application/json' },
    })
    if (route === 'health' || route === 'version') {
      const response = await proxyStatusRequest(request('status'), async (url) => {
        if (route === 'health' && String(url).endsWith('/health')) return upstream
        if (route === 'version' && String(url).endsWith('/version')) return upstream
        return Response.json(JSON.parse(health))
      })
      assert.equal(response.status, 200)
      if (route === 'health') assert.equal((await response.json()).online, false)
      else assert.equal((await response.json()).version, 'Unknown')
    } else {
      const response = await (route === 'debug'
        ? proxyDebugRequest(request(route), async () => upstream)
        : proxyMetricsRequest(request(route), async () => upstream)
      ).catch(proxyErrorResponse)
      assert.equal(response.status, 502)
    }
    assert.equal(cancelled, true)
  })
}
