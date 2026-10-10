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
const metrics =
  '# HELP gotenberg_requests_total Requests\n# TYPE gotenberg_requests_total counter\ngotenberg_requests_total 2\n'
const debug = JSON.stringify({ api: { enableDebugRoute: true } })
const health = JSON.stringify({ status: 'up', details: { chromium: { status: 'up' } } })

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

function request(route: 'metrics' | 'debug' | 'status') {
  if (route === 'status') {
    return new Request(`${origin}/api/gotenberg/status?url=${encodeURIComponent(backend)}`)
  }
  return new Request(`${origin}/api/gotenberg/${route}`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend },
  })
}

async function diagnosticResponse(
  route: 'metrics' | 'debug' | 'status',
  body: string,
  extraHeaders: Record<string, string>,
) {
  const type = route === 'metrics' ? 'text/plain' : 'application/json'
  const upstream = new Response(body, {
    headers: { 'Content-Type': type, ...extraHeaders },
  })
  if (route === 'metrics') {
    return proxyMetricsRequest(request(route), async () => upstream).catch(proxyErrorResponse)
  }
  if (route === 'debug') {
    return proxyDebugRequest(request(route), async () => upstream).catch(proxyErrorResponse)
  }
  return proxyStatusRequest(request(route), async (url) =>
    String(url).endsWith('/health') ? upstream : new Response('8.37.0'),
  )
}

const cases = [
  ['metrics', metrics],
  ['debug', debug],
  ['status', health],
] as const

for (const [route, body] of cases) {
  test.each(['invalid', '-1', '1.5', '9007199254740992'])(
    `${route} rejects malformed upstream Content-Length %s`,
    async (length) => {
      const result = await diagnosticResponse(route, body, { 'Content-Length': length })
      if (route === 'status') {
        const status = await result.json()
        assert.equal(status.online, false)
      } else {
        assert.equal(result.status, 502)
      }
    },
  )

  test(`${route} rejects a valid-looking but truncated response`, async () => {
    const result = await diagnosticResponse(route, body, {
      'Content-Length': String(Buffer.byteLength(body) + 5),
    })
    if (route === 'status') {
      const status = await result.json()
      assert.equal(status.online, false)
    } else {
      assert.equal(result.status, 502)
    }
  })

  test(`${route} rejects a body longer than the declared length`, async () => {
    const result = await diagnosticResponse(route, body, {
      'Content-Length': String(Buffer.byteLength(body) - 1),
    })
    if (route === 'status') {
      assert.equal((await result.json()).online, false)
    } else {
      assert.equal(result.status, 502)
    }
  })

  test(`${route} cancels unread upstream bodies when the declared length is invalid`, async () => {
    let cancelled = false
    let reads = 0
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          reads++
        },
        cancel() {
          cancelled = true
        },
      }),
      {
        headers: {
          'Content-Type': route === 'metrics' ? 'text/plain' : 'application/json',
          'Content-Length': 'invalid',
        },
      },
    )
    let result: Response
    if (route === 'status') {
      result = await proxyStatusRequest(request(route), async () => upstream)
      assert.equal((await result.json()).online, false)
    } else if (route === 'metrics') {
      result = await proxyMetricsRequest(request(route), async () => upstream).catch(
        proxyErrorResponse,
      )
      assert.equal(result.status, 502)
    } else {
      result = await proxyDebugRequest(request(route), async () => upstream).catch(
        proxyErrorResponse,
      )
      assert.equal(result.status, 502)
    }
    assert.equal(cancelled, true)
    // The stream may be proactively pulled once by ReadableStream itself.
    assert.ok(reads <= 1)
  })

  test(`${route} accepts a zero-padded but valid Content-Length`, async () => {
    const result = await diagnosticResponse(route, body, {
      'Content-Length': `00${Buffer.byteLength(body)}`,
    })
    assert.equal(result.status, 200)
    if (route === 'status') assert.equal((await result.json()).online, true)
    else assert.ok((await result.text()).length > 0)
  })

  test(`${route} accepts a fully received response with matching length`, async () => {
    const result = await diagnosticResponse(route, body, {
      'Content-Length': String(Buffer.byteLength(body)),
    })
    assert.equal(result.status, 200)
    if (route === 'status') assert.equal((await result.json()).online, true)
    else
      assert.match(
        await result.text(),
        route === 'metrics' ? /gotenberg_requests_total/ : /enableDebugRoute/,
      )
  })

  test(`${route} does not compare compressed Content-Length with a decoded body`, async () => {
    const result = await diagnosticResponse(route, body, {
      'Content-Encoding': 'gzip',
      'Content-Length': '12',
    })
    assert.equal(result.status, 200)
    if (route === 'status') assert.equal((await result.json()).online, true)
    else
      assert.match(
        await result.text(),
        route === 'metrics' ? /gotenberg_requests_total/ : /enableDebugRoute/,
      )
  })
}

test('an incomplete optional /version response is not treated as the reported version', async () => {
  const status = await proxyStatusRequest(request('status'), async (url) => {
    if (String(url).endsWith('/health')) return Response.json(JSON.parse(health))
    return new Response('8.37.0', { headers: { 'Content-Length': '12' } })
  })
  assert.deepEqual(await status.json(), {
    online: true,
    version: 'Unknown',
    modules: [{ name: 'chromium', status: 'up' }],
  })
})
