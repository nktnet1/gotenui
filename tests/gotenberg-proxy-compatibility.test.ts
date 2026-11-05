import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'

function requestFor(
  operation = 'html-pdf',
  fields: Record<string, string | boolean> = {},
  extra: Record<string, unknown> = {},
  files: File[] = [],
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields,
      advanced: {},
      ...(operation === 'html-pdf'
        ? { source: '<html><body>Versioned request</body></html>' }
        : {}),
      ...extra,
    }),
  )
  for (const file of files) body.append('files', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function upstreamFixture(version: string, onConvert: (form: FormData, headers: Headers) => void) {
  let probes = 0
  let conversions = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) {
      probes++
      return new Response(version, { headers: { 'Content-Type': 'text/plain' } })
    }
    assert.equal(options?.method, 'POST')
    assert.ok(options?.body instanceof FormData)
    conversions++
    onConvert(options.body, new Headers(options.headers))
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  return { fetcher, counts: () => ({ probes, conversions }) }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

test('probes /version for each request and changes form encoding after an upstream upgrade', async () => {
  let version = '8.40.0'
  const calls: FormData[] = []
  let probes = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input).endsWith('/version')) {
      probes++
      return new Response(version)
    }
    assert.ok(options?.body instanceof FormData)
    calls.push(options.body)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const payload = () => requestFor('html-pdf', { generateDocumentOutline: true, pdfa: 'PDF/A-2b' })
  assert.equal((await proxyConversionRequest(payload(), fetcher)).status, 200)
  assert.equal(calls[0]?.get('generateDocumentOutline'), 'true')
  assert.equal(calls[0]?.get('nativeBookmarks'), null)
  assert.equal(calls[0]?.get('pdfa'), 'PDF/A-2b')
  version = '9.0.0'
  assert.equal((await proxyConversionRequest(payload(), fetcher)).status, 200)
  assert.equal(calls[1]?.get('generateDocumentOutline'), null)
  assert.equal(calls[1]?.get('nativeBookmarks'), 'true')
  assert.equal(calls[1]?.get('pdfa'), null)
  assert.deepEqual(JSON.parse(String(calls[1]?.get('stages'))), [
    { op: 'remediate', profile: 'PDF/A-2b' },
  ])
  assert.equal(probes, 2)
  assert.equal(calls.length, 2)
})

test('rejects a Gotenberg 9-only option against v8 before forwarding conversion', async () => {
  const fixture = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', { paperSize: 'A4' }), fixture.fetcher),
    /Named paper sizes require Gotenberg 9/,
  )
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
})

test('rejects unmigrated PDF tools and unsupported majors before forwarding', async () => {
  const source = new File(['%PDF-1.7\n'], 'input.pdf', { type: 'application/pdf' })
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('rotate', { rotateAngle: '90' }, {}, [source]), v9.fetcher),
    /not available on Gotenberg 9/,
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 0 })
  const unknown = upstreamFixture('10.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', {}, {}, []), unknown.fetcher),
    /Unsupported Gotenberg version/,
  )
  assert.deepEqual(unknown.counts(), { probes: 1, conversions: 0 })
})

test('rejects incomplete v9 webhooks but preserves v8 callback fields', async () => {
  const base = { url: 'https://callbacks.example.test/success' }
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', {}, { webhook: base }), v9.fetcher),
    /events callback URL/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'html-pdf',
        {},
        {
          webhook: {
            ...base,
            eventsUrl: 'https://callbacks.example.test/events',
            errorUrl: 'https://callbacks.example.test/error',
          },
        },
      ),
      v9.fetcher,
    ),
    /removed the separate webhook error callback/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 0 })

  const v8 = upstreamFixture('8.40.0', (_form, headers) => {
    assert.equal(headers.get('Gotenberg-Webhook-Url'), base.url)
    assert.equal(headers.get('Gotenberg-Webhook-Error-Url'), 'https://callbacks.example.test/error')
  })
  const reply = await proxyConversionRequest(
    requestFor(
      'html-pdf',
      {},
      { webhook: { ...base, errorUrl: 'https://callbacks.example.test/error' } },
    ),
    v8.fetcher,
  )
  assert.equal(reply.status, 200)
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 1 })
})

test('does not forward a conversion when an authenticated /version probe fails', async () => {
  let requests = 0
  const fetcher: typeof fetch = async (input) => {
    requests++
    assert.equal(String(input), `${upstream}/version`)
    return new Response('Unauthorized', { status: 401 })
  }
  await assert.rejects(
    proxyConversionRequest(requestFor(), fetcher),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 401,
  )
  assert.equal(requests, 1)
})

test('refuses v8 multipart PDF attachments on v9 before forwarding conversion', async () => {
  const original = requestFor('html-pdf')
  const body = await original.formData()
  body.append('embeds', new File(['attachment'], 'report.txt', { type: 'text/plain' }))
  const upload = new Request(original.url, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
  const fixture = upstreamFixture('9.0.0', () => {})
  await assert.rejects(proxyConversionRequest(upload, fixture.fetcher), /attach stage/)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
})
