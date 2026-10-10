import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { convertWithGotenberg, createGotenbergForm } from '#/lib/gotenberg-client'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { OPERATION_BY_ID } from '#/lib/operations'
import { validateFiles, validatePayload } from '#/lib/validation'

const origin = 'https://app.example.test'
const target = 'http://127.0.0.1:3000'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', target))
afterEach(() => vi.unstubAllEnvs())

function payloadFor(operation: string, extras: Record<string, unknown> = {}) {
  return { operation, fields: {}, advanced: {}, ...extras }
}

function requestFor(payload: unknown): Request {
  const form = new FormData()
  form.set('payload', JSON.stringify(payload))
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': target },
    body: form,
  })
}

test('downloadFrom supplies remote Office source files without local uploads', () => {
  const { operation, payload } = validatePayload(
    payloadFor('office-pdf', {
      downloadFrom: [{ url: 'https://files.example.test/report.docx' }],
    }),
  )
  validateFiles(operation, [], [], 4_000_000, payload)
  const form = createGotenbergForm(operation, payload, [], [])
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://files.example.test/report.docx' },
  ])
  assert.equal(form.getAll('files').length, 0)
})

test('rejects malformed remote URLs and unsupported descriptors', () => {
  for (const downloadFrom of [
    [{ url: 'file:///etc/passwd' }],
    [{ url: 'http://user:pass@files.example.test/input.docx' }],
    [{ url: 'https://files.example.test/input.docx', field: 'unknown' }],
    [{ url: 'https://files.example.test/input.docx', extraHttpHeaders: { bad: 'a\nB' } }],
  ]) {
    assert.throws(() => validatePayload(payloadFor('office-pdf', { downloadFrom })))
  }
})

test('merge requires at least two combined remote or uploaded PDF inputs', () => {
  const { operation, payload } = validatePayload(
    payloadFor('merge', { downloadFrom: [{ url: 'https://files.example.test/part-a.pdf' }] }),
  )
  assert.throws(() => validateFiles(operation, [], [], 4_000_000, payload), /Upload 2/)
  const second = new File(['%PDF-1.7'], 'part-b.pdf', { type: 'application/pdf' })
  validateFiles(operation, [second], [], 4_000_000, payload)
})

test('reconstructs only validated webhook headers for upstream and preserves 204', async () => {
  const web = payloadFor('url-pdf', {
    fields: { url: 'https://example.test' },
    webhook: {
      url: 'https://hooks.example.test/success',
      eventsUrl: 'https://hooks.example.test/events',
      method: 'PUT',
      extraHttpHeaders: { 'X-Api-Key': 'secret' },
    },
  })
  const request = requestFor(web)
  request.headers.set('Gotenberg-Webhook-Url', 'https://untrusted.example.test/override')
  const response = await proxyConversionRequest(request, async (_input, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('Gotenberg-Webhook-Url'), 'https://hooks.example.test/success')
    assert.equal(headers.get('Gotenberg-Webhook-Events-Url'), 'https://hooks.example.test/events')
    assert.equal(headers.get('Gotenberg-Webhook-Method'), 'PUT')
    assert.equal(headers.get('Gotenberg-Webhook-Extra-Http-Headers'), '{"X-Api-Key":"secret"}')
    return new Response(null, { status: 204, headers: { 'Gotenberg-Trace': 'trace-42' } })
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('gotenberg-trace'), 'trace-42')
  assert.equal(await response.text(), '')
})

test('client treats an accepted webhook job as async, not an empty file download', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 204 })
  try {
    const result = await convertWithGotenberg(
      target,
      payloadFor('url-pdf', {
        fields: { url: 'https://example.test' },
        webhook: { url: 'https://hooks.example.test/success' },
      }),
      [],
      [],
      new AbortController().signal,
    )
    assert.deepEqual(result, { mode: 'webhook', trace: undefined, status: 204 })
  } finally {
    globalThis.fetch = original
  }
})

test('rejects malformed webhook URLs, methods, and header values', () => {
  for (const webhook of [
    { url: 'file:///tmp/secret' },
    { url: 'https://hooks.example.test/success', method: 'GET' },
    {
      url: 'https://hooks.example.test/success',
      extraHttpHeaders: { 'x-api-key': 'token\r\nInjected: yes' },
    },
  ]) {
    assert.throws(() => validatePayload(payloadFor('url-pdf', { webhook })))
  }
})

test('the PDF tools remain available with remote inputs enabled', () => {
  assert.ok(OPERATION_BY_ID.get('merge'))
  assert.ok(OPERATION_BY_ID.get('watermark'))
})

test('async webhook response retains custom correlation while propagating an independent W3C trace', async () => {
  const parent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
  const request = requestFor(
    payloadFor('url-pdf', {
      fields: { url: 'https://example.test' },
      requestTrace: 'async-42',
      traceparent: parent,
      webhook: { url: 'https://hooks.example.test/success' },
    }),
  )
  const response = await proxyConversionRequest(request, async (_input, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('gotenberg-trace'), 'async-42')
    assert.equal(headers.get('traceparent'), parent)
    assert.equal(headers.get('gotenberg-webhook-url'), 'https://hooks.example.test/success')
    return new Response(null, { status: 204, headers: { 'Gotenberg-Trace': 'async-42' } })
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('gotenberg-trace'), 'async-42')
  assert.equal(await response.text(), '')
})

test('client displays accepted HTTP 202 separately from completed conversion responses', async () => {
  const original = globalThis.fetch
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
  try {
    const result = await convertWithGotenberg(
      target,
      payloadFor('url-pdf', {
        fields: { url: 'https://example.test' },
        webhook: { url: 'https://hooks.example.test/success' },
      }),
      [],
      [],
      new AbortController().signal,
    )
    assert.deepEqual(result, { mode: 'webhook', trace: undefined, status: 202 })
  } finally {
    globalThis.fetch = original
  }
})
