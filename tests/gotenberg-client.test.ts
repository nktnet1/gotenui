import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  convertWithGotenberg,
  createGotenbergForm,
  getGotenbergStatus,
} from '../src/lib/gotenberg-client.ts'
import { OPERATION_BY_ID, operationDefaults } from '../src/lib/operations.ts'
import { validatePayload } from '../src/lib/validation.ts'

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

test('sends multipart directly to the configured endpoint and names the download locally', async () => {
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
      'https://api.example.test/gotenberg',
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
    assert.equal(result.name, 'my-output.pdf')
    assert.equal(requests[0]?.url, 'https://api.example.test/gotenberg/forms/chromium/convert/url')
    assert.equal(requests[0]?.options.method, 'POST')
    assert.equal(requests[0]?.options.credentials, 'same-origin')
    assert.equal(requests[0]?.options.headers, undefined)
    const body = requests[0]?.options.body
    assert.ok(body instanceof FormData)
    assert.equal(body.get('url'), 'https://example.test')
  } finally {
    globalThis.fetch = original
  }
})

test('reports a healthy service when a proxy blocks the optional version route', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/version')) throw new TypeError('CORS')
    return Response.json({ status: 'up', details: { chromium: { status: 'up' } } })
  }
  try {
    const status = await getGotenbergStatus('/gotenberg')
    assert.equal(status.online, true)
    assert.equal(status.version, 'Unknown')
    assert.deepEqual(status.modules, [{ name: 'chromium', status: 'up' }])
  } finally {
    globalThis.fetch = original
  }
})

test('rejects static-host SPA fallback returned as a false-positive health check', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('<html>Gotenui shell</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  try {
    const status = await getGotenbergStatus('/gotenberg')
    assert.equal(status.online, false)
    assert.match(status.error ?? '', /not a Gotenberg health check/)
  } finally {
    globalThis.fetch = original
  }
})
