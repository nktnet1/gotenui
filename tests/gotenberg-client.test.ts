import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  convertWithGotenberg,
  createGotenbergForm,
  getGotenbergDebug,
  getGotenbergStatus,
  probeGotenbergHealth,
} from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { validatePayload } from '#/lib/validation'

test('builds Markdown multipart with Gotenberg template and local assets', async () => {
  const operation = OPERATION_BY_ID.get('markdown-pdf')
  assert.ok(operation)
  const payload = validatePayload({
    operation: operation.id,
    fields: operationDefaults(operation),
    advanced: {},
    source: '# Hello world',
  }).payload
  const css = new File(['body { color: blue }'], 'style.css', { type: 'text/css' })
  const form = createGotenbergForm(operation, payload, [], [css])
  const files = form.getAll('files') as File[]
  assert.deepEqual(
    files.map((file) => file.name),
    ['index.html', 'document.md', 'style.css'],
  )
  assert.match(await files[0].text(), /toHTML "document.md"/)
  assert.equal(await files[1].text(), '# Hello world')
})

test('converts through the same-origin API, not direct-to-Gotenberg fetch', async () => {
  const original = globalThis.fetch
  const requests: { url: string; options: RequestInit }[] = []
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options: options ?? {} })
    return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="server.pdf"',
      },
    })
  }
  try {
    const operation = OPERATION_BY_ID.get('url-pdf')
    assert.ok(operation)
    const result = await convertWithGotenberg(
      'http://127.0.0.1:3000',
      {
        operation: operation.id,
        fields: { ...operationDefaults(operation), url: 'https://example.test' },
        advanced: {},
        outputName: 'my-output',
      },
      [],
      [],
      new AbortController().signal,
    )
    assert.equal(result.mode, 'download')
    if (result.mode !== 'download') throw new Error('Expected a direct PDF download')
    assert.equal(result.name, 'my-output.pdf')
    assert.equal(requests[0]?.url, '/api/gotenberg/convert')
    assert.equal(requests[0]?.options.method, 'POST')
    assert.equal(requests[0]?.options.credentials, 'same-origin')
    assert.equal(
      new Headers(requests[0]?.options.headers).get('X-Gotenberg-Url'),
      'http://127.0.0.1:3000',
    )
    const body = requests[0]?.options.body
    assert.ok(body instanceof FormData)
    const payload = JSON.parse(String(body.get('payload')))
    assert.equal(payload.fields.url, 'https://example.test')
    assert.equal(body.has('url'), false)
  } finally {
    globalThis.fetch = original
  }
})

test('reads the JSON status from the same-origin API', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const path = String(input)
    assert.match(path, /^\/api\/gotenberg\/status\?url=http%3A%2F%2F127\.0\.0\.1%3A3000$/)
    return Response.json({
      online: true,
      version: '8.27.0',
      modules: [{ name: 'chromium', status: 'up' }],
    })
  }
  try {
    const status = await getGotenbergStatus('http://127.0.0.1:3000')
    assert.equal(status.online, true)
    assert.equal(status.version, '8.27.0')
    assert.deepEqual(status.modules, [{ name: 'chromium', status: 'up' }])
  } finally {
    globalThis.fetch = original
  }
})

test('reports a helpful error for rejected backends', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('This Gotenberg URL is not approved by the server.', { status: 403 })
  try {
    const status = await getGotenbergStatus('https://unknown.example')
    assert.equal(status.online, false)
    assert.match(status.error ?? '', /not approved/)
  } finally {
    globalThis.fetch = original
  }
})

test('rejects SPA fallback instead of claiming an HTML page is healthy', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('<html>Gotenui shell</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  try {
    const status = await getGotenbergStatus('http://127.0.0.1:3000')
    assert.equal(status.online, false)
    assert.match(status.error ?? '', /Unexpected token|not valid JSON|valid Gotenberg status/)
  } finally {
    globalThis.fetch = original
  }
})

test('server-managed status and conversion select the profile without leaking credentials into URLs', async () => {
  const original = globalThis.fetch
  const captures: { path: string; headers: Headers }[] = []
  globalThis.fetch = async (input, options) => {
    captures.push({ path: String(input), headers: new Headers(options?.headers) })
    if (String(input).includes('/status'))
      return Response.json({ online: true, version: '8.37.0', modules: [] })
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  try {
    const connection = { kind: 'server' as const, id: 'records' }
    const status = await getGotenbergStatus(connection)
    assert.equal(status.online, true)
    const op = OPERATION_BY_ID.get('url-pdf')
    assert.ok(op)
    await convertWithGotenberg(
      connection,
      { operation: op.id, fields: { url: 'https://example.test' }, advanced: {} },
      [],
      [],
      new AbortController().signal,
    )
    assert.equal(captures[0]?.path, '/api/gotenberg/status?connection=records')
    assert.equal(captures[1]?.path, '/api/gotenberg/convert')
    assert.equal(captures[1]?.headers.get('X-Gotenui-Connection-Id'), 'records')
    assert.equal(captures[1]?.headers.has('X-Gotenberg-Url'), false)
  } finally {
    globalThis.fetch = original
  }
})

test('debug diagnostics use a same-origin POST without persisting access credentials', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/gotenberg/debug')
    assert.equal(options?.method, 'POST')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.body, undefined)
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('x-gotenui-debug-access-key'), null)
    assert.equal(headers.get('x-gotenberg-url'), 'http://127.0.0.1:3000')
    assert.equal(headers.get('authorization'), null)
    return Response.json({ flags: { debug: true } })
  }
  try {
    const result = await getGotenbergDebug('http://127.0.0.1:3000')
    assert.deepEqual(result, { flags: { debug: true } })
  } finally {
    globalThis.fetch = original
  }
})

test('debug client rejects SPA fallbacks and exposes disabled-route errors', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      new Response('<html>Fallback</html>', { headers: { 'content-type': 'text/html' } })
    await assert.rejects(getGotenbergDebug('http://127.0.0.1:3000'), /did not return JSON/)
    globalThis.fetch = async () => new Response('Debug not enabled', { status: 404 })
    await assert.rejects(getGotenbergDebug('http://127.0.0.1:3000'), /Debug not enabled/)
  } finally {
    globalThis.fetch = original
  }
})

test('HEAD health probe uses only the same-origin API and distinguishes 200 from 503', async () => {
  const original = globalThis.fetch
  const calls: { url: string; options: RequestInit }[] = []
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options: options ?? {} })
    return new Response(null, {
      status: calls.length === 1 ? 200 : 503,
      headers: { 'X-Gotenui-Health-Probe': '1' },
    })
  }
  try {
    assert.equal(await probeGotenbergHealth('http://127.0.0.1:3000'), true)
    assert.equal(await probeGotenbergHealth('http://127.0.0.1:3000'), false)
    assert.equal(calls[0]?.url, '/api/gotenberg/health?url=http%3A%2F%2F127.0.0.1%3A3000')
    assert.equal(calls[0]?.options.method, 'HEAD')
    assert.equal(calls[0]?.options.credentials, 'same-origin')
    assert.equal(calls[0]?.options.cache, 'no-store')
  } finally {
    globalThis.fetch = original
  }
})

test('HEAD health probe selects server-managed connection without embedding secrets in URL', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/gotenberg/health?connection=private')
    assert.equal(options?.method, 'HEAD')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('X-Gotenui-Profile-Access-Key'), null)
    assert.equal(headers.get('X-Gotenberg-Url'), null)
    return new Response(null, { status: 200, headers: { 'X-Gotenui-Health-Probe': '1' } })
  }
  try {
    assert.equal(await probeGotenbergHealth({ kind: 'server', id: 'private' }), true)
    globalThis.fetch = async () => new Response(null, { status: 403 })
    await assert.rejects(probeGotenbergHealth('http://127.0.0.1:3000'), /HTTP 403/)
  } finally {
    globalThis.fetch = original
  }
})

test('HEAD health rejects a static SPA fallback masquerading as a healthy server', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } })
  try {
    await assert.rejects(
      probeGotenbergHealth('http://127.0.0.1:3000'),
      /did not reach the Gotenui API/,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('download filename uses upstream response when unspecified and the local override when provided', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('%PDF', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="from-gotenberg.pdf"',
        'Gotenberg-Trace': 'upstream-42',
      },
    })
  try {
    const base = {
      operation: 'url-pdf',
      fields: { url: 'https://example.test' },
      advanced: {},
    }
    const automatic = await convertWithGotenberg(
      'http://127.0.0.1:3000',
      base,
      [],
      [],
      new AbortController().signal,
    )
    assert.equal(automatic.mode, 'download')
    if (automatic.mode === 'download') {
      assert.equal(automatic.name, 'from-gotenberg.pdf')
      assert.equal(automatic.trace, 'upstream-42')
    }
    const overridden = await convertWithGotenberg(
      'http://127.0.0.1:3000',
      { ...base, outputName: 'renamed' },
      [],
      [],
      new AbortController().signal,
    )
    assert.equal(overridden.mode, 'download')
    if (overridden.mode === 'download') assert.equal(overridden.name, 'renamed.pdf')
  } finally {
    globalThis.fetch = original
  }
})

test('client reports upstream correlation IDs on rejected conversions', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('Bad parameters', {
      status: 400,
      headers: { 'Gotenberg-Trace': 'bad-request-99' },
    })
  try {
    await assert.rejects(
      convertWithGotenberg(
        'http://127.0.0.1:3000',
        { operation: 'url-pdf', fields: { url: 'https://example.test' }, advanced: {} },
        [],
        [],
        new AbortController().signal,
      ),
      /Bad parameters.*bad-request-99/,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('browser sends named post-processing uploads only to the same-origin proxy', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), '/api/gotenberg/convert')
    assert.equal(options?.credentials, 'same-origin')
    const body = options?.body
    assert.ok(body instanceof FormData)
    assert.equal(body.get('watermark') instanceof File, true)
    assert.equal((body.get('watermark') as File).name, 'logo.png')
    assert.deepEqual(
      (body.getAll('embeds') as File[]).map((file) => file.name),
      ['report.txt'],
    )
    assert.equal(body.has('watermarkSource'), false)
    assert.equal(body.has('stampExpression'), false)
    const payload = JSON.parse(String(body.get('payload')))
    assert.equal(payload.postProcess.watermark.source, 'image')
    assert.equal(payload.postProcess.stamp.expression, 'INTERNAL')
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  try {
    const result = await convertWithGotenberg(
      { kind: 'server', id: 'records' },
      {
        operation: 'url-pdf',
        fields: { url: 'https://example.test' },
        advanced: {},
        postProcess: {
          watermark: { source: 'image' },
          stamp: { source: 'text', expression: 'INTERNAL' },
        },
      },
      [],
      [],
      new AbortController().signal,
      { watermark: new File(['logo'], 'logo.png'), embeds: [new File(['report'], 'report.txt')] },
    )
    assert.equal(result.mode, 'download')
  } finally {
    globalThis.fetch = original
  }
})

test('the browser preserves repeated local overlay files while sending only validated settings as JSON', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    const body = options?.body
    assert.ok(body instanceof FormData)
    const metadata = JSON.parse(String(body.get('payload')))
    assert.equal(metadata.operation, 'url-pdf')
    assert.deepEqual(
      metadata.postProcess.watermarks.map((entry: { source: string }) => entry.source),
      ['text', 'image', 'pdf'],
    )
    assert.deepEqual(
      (body.getAll('watermark') as File[]).map((file) => file.name),
      ['logo.png', 'underlay.pdf'],
    )
    assert.equal(body.has('watermarkSource'), false)
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  }
  try {
    await convertWithGotenberg(
      'http://127.0.0.1:3000',
      {
        operation: 'url-pdf',
        fields: { url: 'https://example.test' },
        advanced: {},
        postProcess: {
          watermarks: [
            { source: 'text', expression: 'REVIEW' },
            { source: 'image', expression: 'logo.png' },
            { source: 'pdf', expression: 'underlay.pdf' },
          ],
        },
      },
      [],
      [],
      new AbortController().signal,
      {
        watermark: [new File(['PNG'], 'logo.png'), new File(['PDF'], 'underlay.pdf')],
      },
    )
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls, 1)
})
