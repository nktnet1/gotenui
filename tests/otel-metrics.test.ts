import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetricsPanel } from '#/components/metrics-panel'
import { getGotenbergMetricsReport } from '#/lib/gotenberg-client'
import { proxyErrorResponse, proxyMetricsRequest } from '#/lib/gotenberg-proxy.server'
import { parseAllowedBackends } from '#/lib/proxy-policy'
import {
  parseMetricsUrl,
  parseServerConnections,
  publicServerConnections,
} from '#/lib/server-connections.server'

const origin = 'https://gotenui.example.test'
const backend = 'http://gotenberg:3000'
const exporter = 'http://gotenberg:9464/metrics'
const metricText = '# HELP request_count Requests\n# TYPE request_count counter\nrequest_count 42\n'

function request(id = 'private', overrides: Record<string, string> = {}) {
  return new Request(`${origin}/api/gotenberg/metrics`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenui-Connection-Id': id, ...overrides },
  })
}

function settings(metricsAuth?: object) {
  return JSON.stringify([
    {
      id: 'private',
      name: 'Private',
      url: backend,
      auth: { type: 'bearer', token: 'secret-gotenberg-token' },
      metricsUrl: exporter,
      ...(metricsAuth && { metricsAuth }),
    },
  ])
}

beforeEach(() => {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend)
  vi.stubEnv('GOTENUI_SERVER_CONNECTIONS', settings())
})
afterEach(() => vi.unstubAllEnvs())

describe('deployment-defined OpenTelemetry Prometheus exporter', () => {
  it('keeps the exporter target and its credentials private', () => {
    const parsed = parseServerConnections(
      { GOTENUI_SERVER_CONNECTIONS: settings() },
      parseAllowedBackends(backend),
    )
    expect(publicServerConnections(parsed.connections)).toEqual([
      { id: 'private', name: 'Private' },
    ])
    const serialized = JSON.stringify(publicServerConnections(parsed.connections))
    expect(serialized).not.toContain('9464')
    expect(serialized).not.toContain('secret-gotenberg-token')
    expect(parsed.connections[0]?.metricsUrl).toBe(exporter)
  })

  it('fetches only the server-defined exporter with no inherited Gotenberg authorization', async () => {
    const result = await proxyMetricsRequest(request(), async (input, options) => {
      assert.equal(input, exporter)
      assert.equal(options?.method, 'GET')
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.cache, 'no-store')
      assert.equal(options?.credentials, 'omit')
      assert.equal(new Headers(options?.headers).has('authorization'), false)
      return new Response(metricText, {
        headers: {
          'Content-Type': 'application/openmetrics-text; version=1.0.0',
          'Set-Cookie': 'bad=value',
        },
      })
    })
    expect(result.status).toBe(200)
    expect(result.headers.get('x-gotenui-metrics-source')).toBe('otel')
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(await result.text()).toBe(metricText)
  })

  it('uses separately scoped exporter credentials only when explicitly configured', async () => {
    vi.stubEnv(
      'GOTENUI_SERVER_CONNECTIONS',
      settings({ type: 'basic', username: 'metrics', password: 'different-secret' }),
    )
    const result = await proxyMetricsRequest(request(), async (input, options) => {
      expect(input).toBe(exporter)
      expect(new Headers(options?.headers).get('authorization')).toBe(
        `Basic ${Buffer.from('metrics:different-secret').toString('base64')}`,
      )
      return new Response(metricText, { headers: { 'Content-Type': 'text/plain' } })
    })
    expect(result.status).toBe(200)
    expect(result.headers.get('authorization')).toBeNull()
  })

  it('does not let browser-supplied URLs or credentials override the configured exporter', async () => {
    for (const [headers, status] of [
      [{ 'X-Gotenberg-Url': 'http://169.254.169.254' }, 400],
      [{ 'X-Gotenui-Upstream-Authorization': 'Bearer attacker' }, 400],
      [{ Origin: 'https://evil.test' }, 403],
    ] as const) {
      await expect(proxyMetricsRequest(request('private', headers))).rejects.toMatchObject({
        status,
      })
    }
    const result = await proxyMetricsRequest(request('missing'), async () => {
      throw new Error('must not fetch')
    }).catch(proxyErrorResponse)
    expect(result.status).toBe(404)
  })

  it('fails closed for malformed deployment exporter URLs', () => {
    for (const bad of [
      'http://server:9464/debug',
      'http://server:9464/metrics?x=1',
      'http://user:secret@server:9464/metrics',
      'file:///etc/passwd',
      '//server:9464/metrics',
      'https://server:9464/metrics#key',
    ]) {
      expect(() => parseMetricsUrl(bad)).toThrow(/metricsUrl/)
    }
    expect(() =>
      parseServerConnections(
        {
          GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
            {
              id: 'broken',
              name: 'Broken',
              url: backend,
              metricsAuth: { type: 'bearer', token: 'key' },
            },
          ]),
        },
        parseAllowedBackends(backend),
      ),
    ).toThrow(/require metricsUrl/)
  })

  it('does not leak exporter errors or authentication challenges', async () => {
    const result = await proxyMetricsRequest(
      request(),
      async () =>
        new Response('private failure data', {
          status: 403,
          headers: { 'WWW-Authenticate': 'Basic realm="secret"', 'Set-Cookie': 'key=x' },
        }),
    )
    expect(result.status).toBe(403)
    expect(result.headers.get('www-authenticate')).toBeNull()
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(await result.text()).not.toContain('private failure data')
  })

  it('reports the source to the viewer without exposing the internal endpoint', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(metricText, {
        headers: {
          'Content-Type': 'text/plain',
          'X-Gotenui-Metrics': '1',
          'X-Gotenui-Metrics-Source': 'otel',
        },
      })
    try {
      const report = await getGotenbergMetricsReport({ kind: 'server', id: 'private' })
      expect(report).toEqual({ text: metricText, source: 'otel' })
    } finally {
      globalThis.fetch = originalFetch
    }
    const html = renderToStaticMarkup(
      createElement(MetricsPanel, {
        connection: { kind: 'server', id: 'private' },
        active: true,
      }),
    )
    expect(html).toContain('OpenTelemetry Prometheus exporter')
    expect(html).toContain('Read metrics')
    expect(html).not.toContain(exporter)
  })
})
