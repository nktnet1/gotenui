import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  proxyConnectionsRequest,
  proxyConversionRequest,
  proxyErrorResponse,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'

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

function managedRequest(): Request {
  const request = conversionRequest()
  request.headers.delete('X-Gotenberg-Url')
  request.headers.set('X-Gotenui-Connection-Id', 'legacy-basic')
  return request
}
function setLegacyAuth() {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', 'http://127.0.0.1:3000,https://demo.gotenberg.dev')
  vi.stubEnv('GOTENBERG_BASIC_AUTH_URL', 'http://127.0.0.1:3000')
  vi.stubEnv('GOTENBERG_BASIC_AUTH_USERNAME', 'test-user')
  vi.stubEnv('GOTENBERG_BASIC_AUTH_PASSWORD', 'test-password')
}

test('server-managed Basic Auth requires selecting the configured profile', async () => {
  setLegacyAuth()
  const expected = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`
  const fetcher: typeof fetch = async (_input, options) => {
    assert.equal(new Headers(options?.headers).get('authorization'), expected)
    assert.equal(options?.redirect, 'error')
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  assert.equal((await proxyConversionRequest(managedRequest(), fetcher)).status, 200)
  const urlOnly = await proxyConversionRequest(conversionRequest(), async (_input, options) => {
    // Selecting the matching URL alone cannot use environment secrets.
    assert.equal(new Headers(options?.headers).get('authorization'), null)
    return new Response('Unauthorized', { status: 401 })
  })
  assert.equal(urlOnly.status, 401)
  const forged = managedRequest()
  forged.headers.set('X-Gotenui-Upstream-Authorization', 'Bearer forged')
  await assert.rejects(proxyConversionRequest(forged), /cannot override/)

  const demo = await proxyConversionRequest(
    conversionRequest('https://demo.gotenberg.dev'),
    async (_input, options) => {
      assert.equal(new Headers(options?.headers).get('authorization'), null)
      return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(demo.status, 200)
})

test('server-managed status forwards credentials without exposing them in JSON', async () => {
  setLegacyAuth()
  let requests = 0
  const expected = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`
  const fetcher: typeof fetch = async (input, options) => {
    requests++
    assert.equal(new Headers(options?.headers).get('authorization'), expected)
    if (String(input).endsWith('/version')) return new Response('8.37.0')
    return Response.json({ status: 'up', details: {} })
  }
  const status = await proxyStatusRequest(
    new Request(`${origin}/api/gotenberg/status?connection=legacy-basic`),
    fetcher,
  )
  assert.equal(requests, 2)
  assert.deepEqual(await status.json(), { online: true, version: '8.37.0', modules: [] })
  assert.equal(status.headers.get('authorization'), null)
  assert.equal(status.headers.get('cache-control'), 'no-store')
})

test('upstream 401 is preserved without leaking authentication headers', async () => {
  setLegacyAuth()
  vi.stubEnv('GOTENBERG_BASIC_AUTH_PASSWORD', 'wrong-password')
  const response = await proxyConversionRequest(
    managedRequest(),
    async () =>
      new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Gotenberg"' },
      }),
  )
  assert.equal(response.status, 401)
  assert.equal(await response.text(), 'Unauthorized')
  assert.equal(response.headers.get('www-authenticate'), null)
  assert.equal(response.headers.get('authorization'), null)
})

test('status rejects protected version responses even when the public health endpoint is up', async () => {
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/version')) return new Response('Unauthorized', { status: 401 })
    return Response.json({ status: 'up', details: {} })
  }
  const response = await proxyStatusRequest(
    new Request(`${origin}/api/gotenberg/status?url=http%3A%2F%2F127.0.0.1%3A3000`),
    fetcher,
  )
  assert.deepEqual(await response.json(), {
    online: false,
    version: 'Unavailable',
    modules: [],
    error: 'Gotenberg returned HTTP 401 from /version.',
  })
})

test('browser-supplied Authorization headers are never forwarded to Gotenberg', async () => {
  const request = conversionRequest()
  request.headers.set('Authorization', 'Basic forged-browser-token')
  const response = await proxyConversionRequest(request, async (_input, options) => {
    assert.equal(new Headers(options?.headers).get('authorization'), null)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal(response.status, 200)
})

test('connections metadata endpoint never leaks server URLs or credentials', async () => {
  setLegacyAuth()
  const response = proxyConnectionsRequest(new Request(`${origin}/api/gotenberg/connections`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.text()
  assert.deepEqual(JSON.parse(body), {
    connections: [{ id: 'legacy-basic', name: 'Private Gotenberg (legacy)' }],
    features: { showDebug: true, showMetrics: true },
  })
  assert.doesNotMatch(body, /test-password|127\.0\.0\.1|Basic [A-Za-z]/)
})

test('forwards only validated request metadata; browser-supplied tracing headers cannot override it', async () => {
  const request = conversionRequest()
  const form = await request.formData()
  const payload = JSON.parse(String(form.get('payload')))
  const parent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
  Object.assign(payload, {
    outputName: 'my-report',
    requestTrace: 'customer-ref-123',
    traceparent: parent,
    tracestate: 'tenant@host=1,vendor=2',
  })
  form.set('payload', JSON.stringify(payload))
  const submitted = new Request(request.url, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Gotenberg-Url': 'http://127.0.0.1:3000',
      'Gotenberg-Output-Filename': 'forged',
      'Gotenberg-Trace': 'forged',
      traceparent: '00-99999999999999999999999999999999-9999999999999999-01',
      tracestate: 'unauthorised=yes',
      Cookie: 'session=secret',
    },
    body: form,
  })
  const response = await proxyConversionRequest(submitted, async (_input, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('gotenberg-output-filename'), 'my-report')
    assert.equal(headers.get('gotenberg-trace'), 'customer-ref-123')
    assert.equal(headers.get('traceparent'), parent)
    assert.equal(headers.get('tracestate'), 'tenant@host=1,vendor=2')
    assert.equal(headers.get('cookie'), null)
    assert.equal(headers.get('authorization'), null)
    return new Response('%PDF', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="my-report.pdf"',
        'Gotenberg-Trace': 'customer-ref-123',
      },
    })
  })
  assert.equal(response.headers.get('gotenberg-trace'), 'customer-ref-123')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="my-report.pdf"')
  assert.equal(response.headers.get('traceparent'), null)
})

test('omitted metadata does not override upstream auto-generated names or traces', async () => {
  const response = await proxyConversionRequest(conversionRequest(), async (_input, options) => {
    const headers = new Headers(options?.headers)
    for (const header of [
      'gotenberg-output-filename',
      'gotenberg-trace',
      'traceparent',
      'tracestate',
    ]) {
      assert.equal(headers.has(header), false)
    }
    return new Response('%PDF', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="upstream-default.pdf"',
        'Gotenberg-Trace': 'auto-uuid',
      },
    })
  })
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="upstream-default.pdf"',
  )
  assert.equal(response.headers.get('gotenberg-trace'), 'auto-uuid')
})

test('Gotenberg request correlation is exposed on errors without forwarding credentials', async () => {
  const response = await proxyConversionRequest(
    conversionRequest(),
    async () =>
      new Response('Invalid conversion options', {
        status: 400,
        headers: { 'Gotenberg-Trace': 'rejected-job-42', 'Set-Cookie': 'secret=1' },
      }),
  )
  assert.equal(response.status, 400)
  assert.equal(response.headers.get('gotenberg-trace'), 'rejected-job-42')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(await response.text(), 'Invalid conversion options')
})

test('Gotenberg JSON metadata endpoints do not receive a binary output filename override', async () => {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation: 'metadata-read',
      fields: {},
      advanced: {},
      outputName: 'browser-data',
    }),
  )
  form.append('files', new File(['%PDF-1.7'], 'source.pdf', { type: 'application/pdf' }))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  const response = await proxyConversionRequest(request, async (_input, options) => {
    assert.equal(new Headers(options?.headers).get('Gotenberg-Output-Filename'), null)
    return Response.json({ 'source.pdf': { PageCount: 1 } })
  })
  assert.equal(response.status, 200)
})

test('the proxy reconstitutes Chromium headers and named Markdown assets without raw header forwarding', async () => {
  const header = '<html><head></head><body>Header</body></html>'
  const footer = '<html><head></head><body>Footer</body></html>'
  const template =
    '<html><head><link rel="stylesheet" href="theme.css"></head><body>{{ toHTML "first.md" }}{{ toHTML "second.md" }}</body></html>'
  const fields = new FormData()
  fields.set(
    'payload',
    JSON.stringify({
      operation: 'markdown-pdf',
      fields: {},
      advanced: {},
      source: '# First',
      markdownName: 'first.md',
      markdownFiles: [{ name: 'second.md', content: '# Second' }],
      markdownTemplate: template,
      headerHtml: header,
      footerHtml: footer,
    }),
  )
  fields.append('auxiliary', new File(['body { color: blue }'], 'theme.css'))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000', Cookie: 'secret=1' },
    body: fields,
  })
  const response = await proxyConversionRequest(request, async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:3000/forms/chromium/convert/markdown')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('Cookie'), null)
    assert.equal(headers.get('Content-Type'), null)
    assert.equal(headers.get('Gotenberg-Webhook-Url'), null)
    const form = options?.body
    assert.ok(form instanceof FormData)
    assert.deepEqual(
      (form.getAll('files') as File[]).map((file) => file.name),
      ['index.html', 'first.md', 'second.md', 'theme.css', 'header.html', 'footer.html'],
    )
    assert.equal(form.has('index.html'), false)
    const fileList = form.getAll('files') as File[]
    assert.equal(await fileList[0]?.text(), template)
    assert.equal(await fileList[1]?.text(), '# First')
    assert.equal(await fileList[2]?.text(), '# Second')
    assert.equal(await fileList[4]?.text(), header)
    assert.equal(await fileList[5]?.text(), footer)
    assert.equal(form.has('headerHtml'), false)
    assert.equal(form.has('footerHtml'), false)
    assert.equal(form.has('markdownTemplate'), false)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal(response.status, 200)
})

test('the proxy rejects reserved asset filenames before contacting the backend', async () => {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      source: '<html><body>Hi</body></html>',
      headerHtml: '<html><head></head><body>Header</body></html>',
    }),
  )
  form.append('auxiliary', new File(['forged'], 'header.html'))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  let calls = 0
  await assert.rejects(
    proxyConversionRequest(request, async () => {
      calls++
      return new Response('not expected')
    }),
    /Duplicate filename: header.html/,
  )
  assert.equal(calls, 0)
})

test('routes conversion post-processing files through the named fields without exposing proxy payloads', async () => {
  const input = new FormData()
  input.set(
    'payload',
    JSON.stringify({
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      source: '<html><head></head><body>Document</body></html>',
      postProcess: {
        watermark: { source: 'image' },
        stamp: { source: 'text', expression: 'DRAFT' },
        facturxConformanceLevel: 'MINIMUM',
        embedsMetadata: '{"report.txt":{"mimeType":"text/plain","relationship":"Supplement"}}',
      },
    }),
  )
  input.append('watermark', new File(['png'], 'logo.png', { type: 'image/png' }))
  input.append('embeds', new File(['text'], 'report.txt'))
  input.append('facturxXml', new File(['<Invoice />'], 'invoice.xml'))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: input,
  })
  request.headers.set('X-Internal-File-Routing', 'malicious')
  const response = await proxyConversionRequest(request, async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:3000/forms/chromium/convert/html')
    assert.equal(new Headers(init?.headers).has('X-Internal-File-Routing'), false)
    assert.equal(init?.redirect, 'error')
    const outgoing = init?.body
    assert.ok(outgoing instanceof FormData)
    assert.deepEqual(
      (outgoing.getAll('files') as File[]).map((file) => file.name),
      ['index.html'],
    )
    assert.equal(outgoing.get('watermarkSource'), 'image')
    assert.equal(outgoing.get('watermarkExpression'), 'logo.png')
    assert.equal(outgoing.get('stampExpression'), 'DRAFT')
    assert.equal(outgoing.get('facturxConformanceLevel'), 'MINIMUM')
    assert.equal((outgoing.get('facturxXml') as File).name, 'invoice.xml')
    assert.deepEqual(
      (outgoing.getAll('embeds') as File[]).map((file) => file.name),
      ['report.txt'],
    )
    assert.equal(outgoing.has('payload'), false)
    assert.equal(outgoing.has('postProcess'), false)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal(response.status, 200)
})

test('rejects excess overlay file fields and unsupported file destinations before forwarding', async () => {
  for (const fields of [
    [
      ['watermark', 'one.png'],
      ['watermark', 'two.png'],
    ],
    [['unknown', 'malicious.pdf']],
  ]) {
    const input = new FormData()
    input.set(
      'payload',
      JSON.stringify({
        operation: 'url-pdf',
        fields: { url: 'https://example.test' },
        advanced: {},
        postProcess: { watermark: { source: 'image' } },
      }),
    )
    for (const [key, name] of fields) input.append(key, new File(['data'], name))
    const request = new Request(`${origin}/api/gotenberg/convert`, {
      method: 'POST',
      headers: { origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
      body: input,
    })
    await assert.rejects(
      proxyConversionRequest(request, async () => {
        throw new Error('Must not call upstream')
      }),
      /exactly one local or remote watermark|unsupported fields/,
    )
  }
})

test('proxy preserves ordered overlay groups and repeats file parts without accepting arbitrary headers', async () => {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation: 'url-pdf',
      fields: { url: 'https://example.test' },
      advanced: {},
      postProcess: {
        watermarks: [
          { source: 'text', expression: 'FIRST', options: '{"rotation":0}' },
          { source: 'image', expression: 'a.png' },
          { source: 'pdf', expression: 'b.pdf', pages: '2' },
        ],
        stamps: [
          { source: 'text', expression: 'READY' },
          { source: 'image', expression: 'seal.png' },
        ],
      },
    }),
  )
  form.append('watermark', new File(['PDF'], 'b.pdf'))
  form.append('watermark', new File(['PNG'], 'a.png'))
  form.append('stamp', new File(['PNG'], 'seal.png'))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  request.headers.set('X-Untrusted-Overlay', 'malicious')
  let forwarded = 0
  const response = await proxyConversionRequest(request, async (target, init) => {
    forwarded++
    assert.equal(String(target), 'http://127.0.0.1:3000/forms/chromium/convert/url')
    assert.equal(new Headers(init?.headers).has('X-Untrusted-Overlay'), false)
    const outgoing = init?.body
    assert.ok(outgoing instanceof FormData)
    assert.deepEqual(outgoing.getAll('watermarkSource'), ['text', 'image', 'pdf'])
    assert.deepEqual(outgoing.getAll('watermarkExpression'), ['FIRST', 'a.png', 'b.pdf'])
    assert.deepEqual(outgoing.getAll('watermarkPages'), ['', '', '2'])
    assert.deepEqual(outgoing.getAll('watermarkOptions'), ['{"rotation":0}', '', ''])
    assert.deepEqual(outgoing.getAll('stampSource'), ['text', 'image'])
    assert.deepEqual(outgoing.getAll('stampExpression'), ['READY', 'seal.png'])
    assert.deepEqual(
      (outgoing.getAll('watermark') as File[]).map((file) => file.name),
      ['a.png', 'b.pdf'],
    )
    assert.deepEqual(
      (outgoing.getAll('stamp') as File[]).map((file) => file.name),
      ['seal.png'],
    )
    assert.equal(outgoing.has('payload'), false)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal(forwarded, 1)
  assert.equal(response.status, 200)
})

test('proxy rejects repeated files that do not match the declared overlay rows', async () => {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation: 'watermark',
      fields: {},
      advanced: {},
      postProcess: { watermarks: [{ source: 'image', expression: 'logo.png' }] },
    }),
  )
  form.append('files', new File(['PDF'], 'source.pdf'))
  form.append('watermark', new File(['PNG'], 'logo.png'))
  form.append('watermark', new File(['PNG'], 'other.png'))
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  await assert.rejects(
    proxyConversionRequest(request, async () => {
      throw new Error('Rejected requests must not reach Gotenberg.')
    }),
    /exactly one local or remote watermark/,
  )
})

test('Chromium resource authentication stays in validated multipart fields, not proxy HTTP headers', async () => {
  const settings = {
    cookies: JSON.stringify([
      { name: 'session', value: 'browser-secret', domain: 'example.test', secure: true },
    ]),
    extraHttpHeaders: JSON.stringify({
      Authorization: 'Bearer site-secret;scope=^https://example\\.test/',
    }),
  }
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: 'url-pdf',
      fields: { url: 'https://example.test/', ...settings },
      advanced: {},
    }),
  )
  const input = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: {
      origin,
      'X-Gotenberg-Url': 'http://127.0.0.1:3000',
      Cookie: 'gotenui-browser-cookie=not-for-upstream',
      Authorization: 'Bearer not-for-upstream',
    },
    body,
  })
  const fetcher: typeof fetch = async (_url, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('cookie'), null)
    assert.equal(headers.get('authorization'), null)
    assert.equal(headers.get('extraHttpHeaders'), null)
    const form = options?.body
    assert.ok(form instanceof FormData)
    assert.equal(form.get('cookies'), settings.cookies)
    assert.equal(form.get('extraHttpHeaders'), settings.extraHttpHeaders)
    assert.equal(form.has('payload'), false)
    return new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
  }
  assert.equal((await proxyConversionRequest(input, fetcher)).status, 200)
})

test('the proxy rejects unscoped resource credentials before making an upstream request', async () => {
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      operation: 'html-pdf',
      fields: { extraHttpHeaders: JSON.stringify({ Authorization: 'Bearer not-scoped' }) },
      advanced: {},
      source: '<html><body>Credentials test</body></html>',
    }),
  )
  const request = new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { origin, 'X-Gotenberg-Url': 'http://127.0.0.1:3000' },
    body: form,
  })
  let called = false
  const fetcher: typeof fetch = async () => {
    called = true
    return new Response('%PDF-1.7')
  }
  await assert.rejects(proxyConversionRequest(request, fetcher), /explicit URL scope/)
  assert.equal(called, false)
})
