import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  proxyConversionRequest,
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
    const response = await proxyMetricsRequest(request('metrics'), async (url) =>
      String(url).endsWith('/version')
        ? new Response('8.40.0')
        : new Response(metrics, { status, headers: { 'Content-Type': 'text/plain' } }),
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
        : proxyMetricsRequest(request(route), async (url) =>
            String(url).endsWith('/version') ? new Response('8.40.0') : upstream,
          )
      ).catch(proxyErrorResponse)
      assert.equal(response.status, 502)
    }
    assert.equal(cancelled, true)
  })
}

function conversionRequest(): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({ operation: 'url-pdf', fields: { url: 'https://example.test' }, advanced: {} }),
  )
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend },
    body,
  })
}

for (const status of [201, 206]) {
  for (const route of ['conversion', 'metrics'] as const) {
    test(`${route} requires a complete HTTP 200 version probe, rejecting HTTP ${status}`, async () => {
      let cancelled = false
      const calls: string[] = []
      const fetcher: typeof fetch = async (url) => {
        calls.push(String(url))
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
          { status },
        )
      }
      const result = await (route === 'conversion'
        ? proxyConversionRequest(conversionRequest(), fetcher)
        : proxyMetricsRequest(request('metrics'), fetcher)
      ).catch(proxyErrorResponse)
      assert.equal(result.status, 502)
      assert.match(await result.text(), /Could not verify the Gotenberg version/)
      assert.deepEqual(calls, [`${backend}/version`])
      assert.equal(cancelled, true)
    })
  }
}

test('overlong versions cannot become valid after truncation in the status probe', async () => {
  const version = `9.10.0-${'a'.repeat(73)}!`
  assert.equal(version.slice(0, 80).length, 80)
  const status = await proxyStatusRequest(request('status'), async (url) =>
    String(url).endsWith('/health') ? Response.json(JSON.parse(health)) : new Response(version),
  )
  assert.deepEqual(await status.json(), { online: true, version: 'Unknown', modules: [] })
  const calls: string[] = []
  const result = await proxyConversionRequest(conversionRequest(), async (url) => {
    calls.push(String(url))
    return new Response(`${version.slice(0, 80)}a`)
  }).catch(proxyErrorResponse)
  assert.equal(result.status, 409)
  assert.deepEqual(calls, [`${backend}/version`])
})

test('valid complete versions with prerelease and build metadata retain their diagnostic header', async () => {
  const version = '9.10.0-rc.1+build.2'
  const result = await proxyConversionRequest(conversionRequest(), async (url) =>
    String(url).endsWith('/version')
      ? new Response(version)
      : new Response('%PDF-1.7', {
          headers: { 'Content-Type': 'application/pdf', 'Gotenberg-Version': version },
        }),
  )
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('Gotenberg-Version'), version)
  await result.body?.cancel()
})
