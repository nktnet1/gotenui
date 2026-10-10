import assert from 'node:assert/strict'
import { test } from 'vitest'
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
    assert.equal(result.name, 'my-output.pdf')
    assert.equal(requests[0]?.url, '/api/gotenberg/convert')
    assert.equal(requests[0]?.options.method, 'POST')
    assert.equal(requests[0]?.options.credentials, 'same-origin')
    assert.deepEqual(requests[0]?.options.headers, {
      'X-Gotenberg-Url': 'http://127.0.0.1:3000',
    })
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
