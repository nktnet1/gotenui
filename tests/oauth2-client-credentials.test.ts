import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { resolveAuthenticatedConnectionTarget } from '#/lib/connection-target.server'
import {
  proxyConversionRequest,
  proxyDebugRequest,
  proxyHeadHealthRequest,
  proxyMetricsRequest,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'
import {
  authorizationForOAuth2,
  clearOAuth2AuthorizationCache,
  invalidateOAuth2Authorization,
  type OAuth2ClientCredentials,
  parseOAuth2TokenUrl,
} from '#/lib/oauth2-client-credentials.server'
import { parseAllowedBackends } from '#/lib/proxy-policy'
import { parseServerConnections, publicServerConnections } from '#/lib/server-connections.server'

const origin = 'https://gotenui.example.test'
const backend = 'https://pdf.example.test'
const alternate = 'https://other.example.test'
const idp = 'https://identity.example.test/oauth2/token'
const basicAuth: OAuth2ClientCredentials = {
  tokenUrl: idp,
  clientId: 'abc:service',
  clientSecret: 'password/+?',
  scope: 'pdf:convert',
  audience: 'gotenberg-api',
  authMethod: 'client_secret_basic',
}
const settings = (auth: OAuth2ClientCredentials = basicAuth) =>
  JSON.stringify([
    { id: 'private', name: 'Private', url: backend, auth: { type: 'oauth2', ...auth } },
  ])
const credentialsResponse = (token = 'jwt.first.signature', seconds: number | string = 3600) =>
  Response.json({ access_token: token, token_type: 'Bearer', expires_in: seconds })

function request(path: string, method = 'GET', extra: Record<string, string> = {}): Request {
  return new Request(`${origin}/api/gotenberg/${path}`, {
    method,
    headers: { Origin: origin, 'X-Gotenui-Connection-Id': 'private', ...extra },
  })
}
function conversionRequest(): Request {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({ operation: 'url-pdf', fields: { url: 'https://example.test' }, advanced: {} }),
  )
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenui-Connection-Id': 'private' },
    body: form,
  })
}

beforeEach(() => {
  clearOAuth2AuthorizationCache()
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', `${backend},${alternate}`)
  vi.stubEnv('GOTENUI_SERVER_CONNECTIONS', settings())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  clearOAuth2AuthorizationCache()
})

test('managed OAuth2 config is server-only, scoped and strictly validated', () => {
  const allowed = parseAllowedBackends(`${backend},${alternate}`)
  const { connections } = parseServerConnections(
    { GOTENUI_SERVER_CONNECTIONS: settings() },
    allowed,
  )
  assert.equal(connections[0]?.authorization, undefined)
  assert.deepEqual(connections[0]?.oauth2, basicAuth)
  assert.deepEqual(publicServerConnections(connections), [{ id: 'private', name: 'Private' }])
  assert.doesNotMatch(
    JSON.stringify(publicServerConnections(connections)),
    /identity|password|clientId|pdf/,
  )
  for (const value of [
    'http://idp.example.test/token',
    'https://user:pass@idp.test/token',
    'https://idp.test/token?secret=hi',
    'https://idp.test/token#fragment',
    '/oauth2/token',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => parseOAuth2TokenUrl(value), /HTTPS/)
  }
  for (const badAuth of [
    { ...basicAuth, clientId: 'bad\nidentifier' },
    { ...basicAuth, scope: 'scope\u0000bad' },
    { ...basicAuth, tokenUrl: 'http://metadata.internal/oauth2/token' },
    { ...basicAuth, clientSecret: 'bad\rsecret' },
  ]) {
    assert.throws(() =>
      parseServerConnections({ GOTENUI_SERVER_CONNECTIONS: settings(badAuth) }, allowed),
    )
  }
  assert.throws(
    () =>
      parseServerConnections(
        {
          GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
            {
              id: 'demo',
              name: 'Demo',
              url: 'https://demo.gotenberg.dev',
              auth: { type: 'oauth2', ...basicAuth },
            },
          ]),
        },
        parseAllowedBackends('https://demo.gotenberg.dev'),
      ),
    /demo/,
  )
})

test('requests client credentials securely, caches token and renews it before expiry', async () => {
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let requests = 0
  const fetcher: typeof fetch = async (input, init) => {
    requests++
    assert.equal(String(input), idp)
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.cache, 'no-store')
    assert.equal(init?.credentials, 'omit')
    assert.ok(init?.signal)
    const fields = init?.body
    assert.ok(fields instanceof URLSearchParams)
    assert.equal(fields.get('grant_type'), 'client_credentials')
    assert.equal(fields.get('scope'), 'pdf:convert')
    assert.equal(fields.get('audience'), 'gotenberg-api')
    assert.equal(fields.has('client_secret'), false)
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      `Basic ${Buffer.from(`${encodeURIComponent('abc:service')}:${encodeURIComponent('password/+?')}`).toString('base64')}`,
    )
    return credentialsResponse(`token-${requests}`, 120)
  }
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer token-1')
  now += 60_000
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer token-1')
  now += 50_000 // renewal at 108 seconds, ahead of 120-second expiry
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer token-2')
  assert.equal(requests, 2)
  invalidateOAuth2Authorization(backend, basicAuth)
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer token-3')
})

test('supports body client authentication and isolates tokens across destinations and credentials', async () => {
  const auth: OAuth2ClientCredentials = { ...basicAuth, authMethod: 'client_secret_post' }
  let count = 0
  const fetcher: typeof fetch = async (_input, init) => {
    count++
    assert.equal(new Headers(init?.headers).get('authorization'), null)
    assert.ok(init?.body instanceof URLSearchParams)
    assert.equal(init.body.get('client_id'), 'abc:service')
    assert.equal(init.body.get('client_secret'), count === 3 ? 'different' : 'password/+?')
    return credentialsResponse(`token-${count}`)
  }
  assert.equal(await authorizationForOAuth2(backend, auth, fetcher), 'Bearer token-1')
  assert.equal(await authorizationForOAuth2(alternate, auth, fetcher), 'Bearer token-2')
  assert.equal(
    await authorizationForOAuth2(backend, { ...auth, clientSecret: 'different' }, fetcher),
    'Bearer token-3',
  )
  assert.equal(await authorizationForOAuth2(backend, auth, fetcher), 'Bearer token-1')
  assert.equal(count, 3)
})

test('single-flights concurrent token requests for the same managed profile', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls++
    await gate
    return credentialsResponse('singleflight')
  }
  const pending = [
    authorizationForOAuth2(backend, basicAuth, fetcher),
    authorizationForOAuth2(backend, basicAuth, fetcher),
    authorizationForOAuth2(backend, basicAuth, fetcher),
  ]
  release?.()
  assert.deepEqual(await Promise.all(pending), [
    'Bearer singleflight',
    'Bearer singleflight',
    'Bearer singleflight',
  ])
  assert.equal(calls, 1)
})

test('rejects upstream token errors and unsafe bodies without leaking responses or secrets', async () => {
  for (const result of [
    new Response('secret=leak', { status: 401 }),
    new Response('<html>gateway</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ access_token: 'token', token_type: 'MAC', expires_in: 500 }),
    Response.json({ access_token: 'bad token', token_type: 'Bearer', expires_in: 500 }),
    Response.json({ access_token: 'token', token_type: 'Bearer', expires_in: -1 }),
    Response.json({ access_token: 'token', token_type: 'Bearer' }),
    new Response('a'.repeat(16_400), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    await assert.rejects(
      authorizationForOAuth2(backend, basicAuth, async () => result),
      (error: Error) => {
        assert.doesNotMatch(error.message, /secret=leak|password|gateway/i)
        return /OAuth2/.test(error.message)
      },
    )
  }
  await assert.rejects(
    authorizationForOAuth2(backend, basicAuth, async () => {
      throw new Error('secret=leak')
    }),
    /OAuth2/,
  )
})

test('managed token reaches conversions, status, health, debug, legacy metrics but not URL-only connections', async () => {
  let tokenCalls = 0
  let upstreamCalls = 0
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url === idp) {
      tokenCalls++
      return credentialsResponse()
    }
    upstreamCalls++
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer jwt.first.signature')
    if (url.endsWith('/health'))
      return init?.method === 'HEAD'
        ? new Response(null)
        : Response.json({ status: 'up', details: {} })
    if (url.endsWith('/version')) return new Response('8.37.0')
    if (url.endsWith('/debug')) return Response.json({ configuration: {} })
    if (url.endsWith('/prometheus/metrics'))
      return new Response('# HELP hello sample\nhello 4', {
        headers: { 'Content-Type': 'text/plain' },
      })
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  assert.equal((await proxyConversionRequest(conversionRequest(), fetcher)).status, 200)
  assert.equal(
    (
      (await (await proxyStatusRequest(request('status?connection=private'), fetcher)).json()) as {
        online: boolean
      }
    ).online,
    true,
  )
  assert.equal(
    (await proxyHeadHealthRequest(request('health?connection=private', 'HEAD'), fetcher)).status,
    200,
  )
  assert.equal((await proxyDebugRequest(request('debug', 'POST'), fetcher)).status, 200)
  assert.equal((await proxyMetricsRequest(request('metrics', 'POST'), fetcher)).status, 200)
  assert.equal(tokenCalls, 1)
  assert.equal(upstreamCalls, 6)
  const allowed = parseAllowedBackends(`${backend},${alternate}`)
  const config = {
    allowed,
    ...parseServerConnections({ GOTENUI_SERVER_CONNECTIONS: settings() }, allowed),
  }
  await assert.rejects(
    resolveAuthenticatedConnectionTarget(
      request('status', 'GET', { 'X-Gotenui-Upstream-Authorization': 'Bearer forged' }),
      config,
      null,
      'private',
      fetcher,
    ),
    /cannot override/,
  )
  const direct = await resolveAuthenticatedConnectionTarget(
    request('status'),
    config,
    backend,
    null,
    fetcher,
  )
  assert.equal(direct.headers, undefined)
  assert.equal(tokenCalls, 1)
})

test('401 from Gotenberg invalidates a cached OAuth2 token for the next request', async () => {
  let tokens = 0
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === idp) return credentialsResponse(`token-${++tokens}`)
    if (new Headers(init?.headers).get('authorization') === 'Bearer token-1') {
      return new Response('denied', { status: 401 })
    }
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  assert.equal((await proxyConversionRequest(conversionRequest(), fetcher)).status, 401)
  assert.equal((await proxyConversionRequest(conversionRequest(), fetcher)).status, 200)
  assert.equal(tokens, 2)
})

test('independent OpenTelemetry exporter never uses or refreshes managed OAuth2 credentials', async () => {
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'private',
        name: 'Private',
        url: backend,
        auth: { type: 'oauth2', ...basicAuth },
        metricsUrl: 'https://metrics.example.test/metrics',
        metricsAuth: { type: 'bearer', token: 'metrics-only' },
      },
    ]),
  )
  let calls = 0
  const fetcher: typeof fetch = async (input, init) => {
    calls++
    assert.equal(String(input), 'https://metrics.example.test/metrics')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer metrics-only')
    return new Response('# HELP example_total Number of examples\nexample_total 1\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  const response = await proxyMetricsRequest(request('metrics', 'POST'), fetcher)
  assert.equal(response.status, 200)
  assert.equal(calls, 1)
})

test('long-lived provider tokens are accepted but cached for no more than one day', async () => {
  let now = 5_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let tokenCount = 0
  const fetcher: typeof fetch = async () => credentialsResponse(`jwt-${++tokenCount}`, 259_200)
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer jwt-1')
  now += 86_341_000
  assert.equal(await authorizationForOAuth2(backend, basicAuth, fetcher), 'Bearer jwt-2')
})

test('cancelling one request stops waiting for a shared token fetch without cancelling other callers', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls++
    await gate
    return credentialsResponse('shared-token')
  }
  const allowed = parseAllowedBackends(backend)
  const registry = {
    allowed,
    ...parseServerConnections({ GOTENUI_SERVER_CONNECTIONS: settings() }, allowed),
  }
  const controller = new AbortController()
  const cancelled = new Request(`${origin}/api/gotenberg/status`, {
    headers: { 'X-Gotenui-Connection-Id': 'private' },
    signal: controller.signal,
  })
  const active = request('status')
  const cancelledResult = resolveAuthenticatedConnectionTarget(
    cancelled,
    registry,
    null,
    'private',
    fetcher,
  )
  const activeResult = resolveAuthenticatedConnectionTarget(
    active,
    registry,
    null,
    'private',
    fetcher,
  )
  controller.abort(new DOMException('Aborted', 'AbortError'))
  await assert.rejects(cancelledResult, /Aborted/)
  release?.()
  assert.equal(
    new Headers((await activeResult).headers).get('Authorization'),
    'Bearer shared-token',
  )
  assert.equal(calls, 1)
})

test('OAuth2 Basic credentials follow form encoding, including spaces and punctuation', async () => {
  const auth: OAuth2ClientCredentials = {
    ...basicAuth,
    clientId: 'client name!*',
    clientSecret: "secret name()'!",
  }
  const fetcher: typeof fetch = async (_input, init) => {
    const actual = new Headers(init?.headers).get('authorization')
    const encoded = `${new URLSearchParams({ value: auth.clientId }).toString().slice(6)}:${new URLSearchParams({ value: auth.clientSecret }).toString().slice(6)}`
    assert.equal(actual, `Basic ${Buffer.from(encoded).toString('base64')}`)
    return credentialsResponse()
  }
  assert.equal(await authorizationForOAuth2(backend, auth, fetcher), 'Bearer jwt.first.signature')
})
