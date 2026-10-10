import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  proxyConversionRequest,
  proxyErrorResponse,
  proxyStatusRequest,
} from '../src/lib/gotenberg-proxy.server.ts'

const origin = 'https://app.example.test'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', 'http://127.0.0.1:3000'))
afterEach(() => vi.unstubAllEnvs())

function conversionRequest(baseUrl = 'http://127.0.0.1:3000', operation = 'url-pdf') {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation,
      fields: { url: 'https://example.test' },
      advanced: {},
    }),
  )
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { 'X-Gotenberg-Url': baseUrl, origin },
    body: form,
  })
}

test('proxies only the operation path, revalidating fields before forwarding', async () => {
  let forwarded = 0
  const fetcher: typeof fetch = async (input, options) => {
    forwarded++
    assert.equal(String(input), 'http://127.0.0.1:3000/forms/chromium/convert/url')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.credentials, 'omit')
    const form = options?.body
    assert.ok(form instanceof FormData)
    assert.equal(form.get('url'), 'https://example.test')
    assert.equal(form.has('payload'), false)
    return new Response('%PDF-1.7', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="converted.pdf"',
        'Gotenberg-Trace': 'trace-42',
        'Set-Cookie': 'secret=1',
      },
    })
  }
  const response = await proxyConversionRequest(conversionRequest(), fetcher)
  assert.equal(forwarded, 1)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(response.headers.get('gotenberg-trace'), 'trace-42')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(await response.text(), '%PDF-1.7')
})

test('validates uploaded PDFs and forwards only Gotenberg file fields', async () => {
  const form = new FormData()
  form.set('payload', JSON.stringify({ operation: 'merge', fields: {}, advanced: {} }))
  form.append('files', new File(['%PDF-1.7'], 'first.pdf', { type: 'application/pdf' }))
  form.append('files', new File(['%PDF-1.7'], 'second.pdf', { type: 'application/pdf' }))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  const fetcher: typeof fetch = async (input, options) => {
    assert.equal(String(input), 'http://127.0.0.1:3000/forms/pdfengines/merge')
    const body = options?.body
    assert.ok(body instanceof FormData)
    assert.equal(body.getAll('files').length, 2)
    assert.equal(body.has('payload'), false)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(request, fetcher)
  assert.equal(response.status, 200)
})

test('the backend cannot be changed to an unapproved host', async () => {
  await assert.rejects(
    proxyConversionRequest(conversionRequest('https://not-approved.example.test')),
    (error: { status?: number }) => error.status === 403,
  )
})

test('malicious extra Gotenberg fields cannot bypass server validation', async () => {
  const request = conversionRequest()
  const form = await request.formData()
  const payload = JSON.parse(String(form.get('payload')))
  payload.advanced = { webhookURL: 'http://127.0.0.1/admin' }
  form.set('payload', JSON.stringify(payload))
  const forbidden = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  await assert.rejects(proxyConversionRequest(forbidden), /Unsupported advanced field/)
})

test('the proxy rejects cross-site requests and oversized multipart bodies', async () => {
  const form = new FormData()
  form.set('payload', 'a'.repeat(2000))
  // Encode the multipart bytes before constructing the Request. Node 24's Undici
  // FormData producer can throw an unhandled rejection if its stream is cancelled.
  const encoded = new Response(form)
  const oversized = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: {
      'Content-Type': encoded.headers.get('Content-Type') ?? '',
      'X-Gotenberg-Url': 'http://127.0.0.1:3000',
    },
    body: await encoded.arrayBuffer(),
  })
  const previous = process.env.GOTENUI_MAX_REQUEST_BYTES
  process.env.GOTENUI_MAX_REQUEST_BYTES = '1024'
  try {
    await assert.rejects(
      proxyConversionRequest(oversized),
      (error: { status?: number }) => error.status === 413,
    )
  } finally {
    if (previous === undefined) delete process.env.GOTENUI_MAX_REQUEST_BYTES
    else process.env.GOTENUI_MAX_REQUEST_BYTES = previous
  }
  const crossSite = conversionRequest()
  crossSite.headers.set('origin', 'https://evil.test')
  await assert.rejects(proxyConversionRequest(crossSite), /Cross-origin/)
})

test('status requests use an approved local target without requiring browser CORS', async () => {
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/version')) return new Response('8.27.0')
    return Response.json({ status: 'up', details: { chromium: { status: 'up' } } })
  }
  const request = new Request(`${origin}/api/gotenberg/status?url=http%3A%2F%2F127.0.0.1%3A3000`)
  const response = await proxyStatusRequest(request, fetcher)
  assert.deepEqual(await response.json(), {
    online: true,
    version: '8.27.0',
    modules: [{ name: 'chromium', status: 'up' }],
  })
  const notApproved = new Request(`${origin}/api/gotenberg/status?url=https%3A%2F%2Fevil.test`)
  const error = await proxyStatusRequest(notApproved).catch(proxyErrorResponse)
  assert.equal(error.status, 403)
})
