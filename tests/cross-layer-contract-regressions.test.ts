import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import {
  fetchConnectionSettings,
  makeBrowserAuthorization,
  newBrowserConnection,
} from '#/lib/connection-profiles'
import { parseBrowserAuthorization } from '#/lib/connection-target.server'
import { upsertPreset } from '#/lib/conversion-presets'
import {
  conversionBinaryPreviewAllowed,
  convertWithGotenberg,
  getGotenbergDebug,
  getGotenbergMetrics,
  getGotenbergStatus,
  probeGotenbergHealth,
} from '#/lib/gotenberg-client'
import { OPERATION_BY_ID } from '#/lib/operations'
import { parseServerConnections } from '#/lib/server-connections.server'
import { parseUpstreamBasicAuth } from '#/lib/upstream-auth.server'

const backend = 'http://localhost:3000'
const connection = { kind: 'browser' as const, url: backend, authorization: 'Bearer token' }
const candidate = { operation: 'url-pdf', fields: { url: 'https://example.test' }, advanced: {} }
const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`
const convert = () =>
  convertWithGotenberg(connection, candidate, [], [], new AbortController().signal)

afterEach(() => vi.unstubAllGlobals())

test('browser and proxy round-trip maximum-size UTF-8 Basic credentials and Bearer tokens', () => {
  for (const [username, password] of [
    ['界'.repeat(255), '密'.repeat(2048)],
    ['\ufeffname', 'password:with:colon'],
    ['😀', '🔐'],
  ]) {
    const authorization = makeBrowserAuthorization('basic', username, password)
    assert.equal(authorization, basic(`${username}:${password}`))
    assert.equal(parseBrowserAuthorization(authorization ?? null), authorization)
  }
  const authorization = makeBrowserAuthorization('bearer', '', 'a'.repeat(4096))
  assert.equal(parseBrowserAuthorization(authorization ?? null), authorization)
})

test.each([
  ['bad:name', 'password'],
  ['bad\nname', 'password'],
  ['name', 'bad\rpassword'],
  ['name', 'bad\u0000password'],
  ['name', 'bad\ud800password'],
  ['a'.repeat(256), 'password'],
  ['name', 'a'.repeat(2049)],
])('browser rejects malformed or oversized Basic credentials', (username, password) => {
  assert.throws(() => makeBrowserAuthorization('basic', username, password))
})

test.each([
  basic('bad\nname:password'),
  basic('name:bad\rpassword'),
  basic('name:bad\u0000password'),
  basic(`${'a'.repeat(256)}:password`),
  basic(`name:${'a'.repeat(2049)}`),
  `Basic ${Buffer.from([0xff, 0x3a, 0x61]).toString('base64')}`,
  'Basic YTpiZh==',
  `Bearer ${'a'.repeat(4097)}`,
])('proxy rejects malformed or oversized upstream credentials', (authorization) => {
  assert.throws(() => parseBrowserAuthorization(authorization))
})

test('browser and proxy enforce the same bearer token length', () => {
  assert.throws(() => makeBrowserAuthorization('bearer', '', 'a'.repeat(4097)))
})

test('deployment-managed and legacy Basic credentials also reject control characters', () => {
  const allowed = new Set([backend])
  assert.throws(
    () =>
      parseServerConnections(
        {
          GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
            {
              id: 'private',
              name: 'Private',
              url: backend,
              auth: { type: 'basic', username: 'user', password: 'bad\npassword' },
            },
          ]),
        },
        allowed,
      ),
    /Invalid Basic Auth/,
  )
  assert.throws(
    () =>
      parseUpstreamBasicAuth(
        {
          GOTENBERG_BASIC_AUTH_URL: backend,
          GOTENBERG_BASIC_AUTH_USERNAME: 'bad\rname',
          GOTENBERG_BASIC_AUTH_PASSWORD: 'pass',
        },
        allowed,
      ),
    /Invalid GOTENBERG_BASIC_AUTH/,
  )
})

test('profiles and presets can generate unique UUIDs on an insecure HTTP origin', () => {
  const random = crypto.getRandomValues.bind(crypto)
  vi.stubGlobal('crypto', { getRandomValues: random })
  const operation = OPERATION_BY_ID.get('url-pdf')
  assert.ok(operation)
  const profile = newBrowserConnection('LAN', backend)
  const other = newBrowserConnection('Other', backend)
  const [preset] = upsertPreset([], operation, 'Preset', { landscape: true })
  const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/
  assert.match(profile.id.slice(8), uuidPattern)
  assert.match(preset.id.slice(7), uuidPattern)
  assert.notEqual(profile.id, other.id)
})

test('all browser API requests refuse redirects rather than following them with private data', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.credentials, 'same-origin')
    const path = String(input)
    calls.push(path.split('?')[0])
    if (path.includes('/status'))
      return Response.json({ online: true, version: '9.9.0', modules: [] })
    if (path.includes('/health'))
      return new Response(null, { headers: { 'X-Gotenui-Health-Probe': '1' } })
    if (path.includes('/debug')) return Response.json({})
    if (path.includes('/metrics'))
      return new Response('metric 1', {
        headers: { 'X-Gotenui-Metrics': '1', 'Content-Type': 'text/plain' },
      })
    if (path.includes('/connections'))
      return Response.json({ connections: [], features: { showDebug: true, showMetrics: true } })
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal((await getGotenbergStatus(connection)).online, true)
  assert.equal(await probeGotenbergHealth(connection), true)
  await getGotenbergDebug(connection)
  await getGotenbergMetrics(connection)
  await fetchConnectionSettings()
  await convert()
  assert.deepEqual(
    calls,
    ['status', 'health', 'debug', 'metrics', 'connections', 'convert'].map(
      (route) => `/api/gotenberg/${route}`,
    ),
  )
})

test.each([200, 201, 206])(
  'rejects unexpected conversion content or status (HTTP %i)',
  async (status) => {
    let cancelled = false
    const body = new ReadableStream({
      cancel() {
        cancelled = true
      },
    })
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(body, {
          status,
          headers: { 'Content-Type': status === 200 ? 'text/html' : 'application/pdf' },
        }),
    )
    await assert.rejects(convert(), /unexpected conversion response/)
    assert.equal(cancelled, true)
  },
)

test.each([202, 204])(
  'rejects asynchronous acceptance without a requested webhook (HTTP %i)',
  async (status) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }))
    await assert.rejects(convert(), /without a webhook/)
  },
)

test.each(['extract-attachments', 'pdf-pipeline'])(
  'standalone %s permits a genuinely named arbitrary attachment, but not a SPA fallback',
  async (operation) => {
    const run = () =>
      convertWithGotenberg(
        connection,
        {
          operation,
          fields: operation === 'pdf-pipeline' ? { stages: '[{"op":"extract-attachments"}]' } : {},
          advanced: {},
        },
        [new File(['%PDF-1.7'], 'source.pdf')],
        [],
        new AbortController().signal,
      )
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    )
    await assert.rejects(run(), /unexpected conversion response/)
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>attachment</html>', {
          headers: {
            'Content-Type': 'text/html',
            'Content-Disposition': 'attachment; filename="document.html"',
          },
        }),
    )
    const result = await run()
    assert.equal(result.mode, 'download')
    if (result.mode !== 'download') throw new Error('Expected a download')
    assert.equal(result.name, 'document.html')
    assert.equal(result.attachment, true)
    assert.equal(await conversionBinaryPreviewAllowed(result), false)
    assert.equal(await result.blob.text(), '<html>attachment</html>')
  },
)

test('diagnostic MIME prefix lookalikes are rejected even when their bodies are valid', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/jsonp' } }),
  )
  await assert.rejects(getGotenbergDebug(connection), /did not return JSON/)
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('metric 1', {
        headers: { 'Content-Type': 'text/plain-extra', 'X-Gotenui-Metrics': '1' },
      }),
  )
  await assert.rejects(getGotenbergMetrics(connection), /did not reach/)
})

test('status and connection settings reject misleading JSON media types', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ online: true, version: '9.9.0', modules: [] }), {
        headers: { 'Content-Type': 'application/jsonp' },
      }),
  )
  assert.equal((await getGotenbergStatus(connection)).online, false)
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ connections: [], features: { showDebug: true, showMetrics: true } }),
        { headers: { 'Content-Type': 'text/plain' } },
      ),
  )
  await assert.rejects(fetchConnectionSettings(), /valid connection settings/)
})

test.each([
  ['application/pdf', '%PDF-1.7', true],
  ['application/pdf', '<html>fake PDF %PDF-1.7</html>', false],
  ['application/pdf', 'preamble%PDF-1.7', true],
  ['application/pdf', `${'x'.repeat(1024)}%PDF-1.7`, false],
  ['application/zip', 'PK\u0003\u0004', true],
  ['application/zip', '', false],
  ['image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), true],
  ['image/png', 'not a PNG', false],
  ['image/jpeg', new Uint8Array([255, 216, 255]), true],
  ['image/webp', 'RIFF\0\0\0\0WEBP', true],
  ['image/svg+xml', '<svg/>', false],
] as const)(
  'checks optional attachment preview signatures without changing the download (%s)',
  async (type, content, allowed) => {
    const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)], {
      type,
    })
    const before = await blob.arrayBuffer()
    assert.equal(
      await conversionBinaryPreviewAllowed({
        mode: 'download',
        attachment: true,
        name: 'file',
        type,
        blob,
      }),
      allowed,
    )
    assert.deepEqual(await blob.arrayBuffer(), before)
  },
)

test('optional attachment signature read errors do not discard completed downloads', async () => {
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
  vi.spyOn(blob, 'slice').mockImplementation(() => {
    throw new Error('Preview unavailable')
  })
  assert.equal(
    await conversionBinaryPreviewAllowed({
      mode: 'download',
      attachment: true,
      blob,
      type: 'application/pdf',
      name: 'file.pdf',
    }),
    false,
  )
  assert.equal(await blob.text(), '%PDF-1.7')
})
