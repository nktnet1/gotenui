import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { describePdfUpstreamError } from '#/lib/gotenberg-v93-errors'
import { OPERATION_BY_ID } from '#/tools/registry'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'
const stageDisabled =
  "Invalid form data: form field 'stages' is disabled on this instance; send the request without it"
const renderBudget =
  "Stage 'render' failed on 'source.pdf': page 1: surface size out of bounds: 5100x6600 exceeds 10000000 pixels; draw at a lower 'dpi', or raise --pdf-max-render-pixels (env PDF_MAX_RENDER_PIXELS)"

function request(
  operation: string,
  fields: Record<string, string | boolean> = {},
  conversionStages?: string,
): Request {
  const data = new FormData()
  data.set(
    'payload',
    JSON.stringify({
      operation,
      fields,
      advanced: {},
      source: '<!doctype html><h1>Fixture</h1>',
      ...(conversionStages ? { conversionStages } : {}),
    }),
  )
  if (operation.startsWith('pdf-') || ['render-pages', 'extract-attachments'].includes(operation)) {
    data.append('files', new File(['%PDF-1.7\n'], 'source.pdf', { type: 'application/pdf' }))
  }
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend },
    body: data,
  })
}

function server(
  version: string,
  response: () => Response,
  check: (path: string, form: FormData) => void,
) {
  let probes = 0
  let conversions = 0
  const fetcher: typeof fetch = async (url, options) => {
    if (String(url) === `${backend}/version`) {
      probes++
      return new Response(version)
    }
    conversions++
    assert.ok(options?.body instanceof FormData)
    check(new URL(String(url)).pathname, options.body)
    return response()
  }
  return { fetcher, counts: () => [probes, conversions] }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

test('9.3 forwards conversion stages and explains an upstream PDF_DISABLE_STAGES rejection', async () => {
  const stages = '[{"op":"optimize"}]'
  const upstream = server(
    '9.3.0',
    () =>
      new Response(stageDisabled, {
        status: 400,
        headers: { 'Gotenberg-Trace': 'v93-stages', 'Gotenberg-Version': '9.3.0' },
      }),
    (path, form) => {
      assert.equal(path, '/forms/chromium/convert/html')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), JSON.parse(stages))
    },
  )
  const result = await proxyConversionRequest(request('html-pdf', {}, stages), upstream.fetcher)
  assert.equal(result.status, 400)
  assert.match(await result.text(), /PDF_DISABLE_STAGES.*Remove PDF processing stages/)
  assert.equal(result.headers.get('Gotenberg-Trace'), 'v93-stages')
  assert.deepEqual(upstream.counts(), [1, 1])
})

test('9.3 Chromium conversions without post-processing omit the stages field', async () => {
  const upstream = server(
    '9.3.0',
    () => new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } }),
    (path, form) => {
      assert.equal(path, '/forms/chromium/convert/html')
      assert.equal(form.has('stages'), false)
    },
  )
  const result = await proxyConversionRequest(request('html-pdf'), upstream.fetcher)
  assert.equal(result.status, 200)
  assert.deepEqual(upstream.counts(), [1, 1])
})

test('9.3 translates Office stage rejection without silently deleting merge stages', async () => {
  const upstream = server(
    '9.3.0',
    () => new Response(stageDisabled, { status: 400 }),
    (path, form) => {
      assert.equal(path, '/forms/libreoffice/convert')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'merge' }])
    },
  )
  const data = new FormData()
  data.set(
    'payload',
    JSON.stringify({ operation: 'office-pdf', fields: { merge: true }, advanced: {} }),
  )
  for (const name of ['first.txt', 'second.txt']) data.append('files', new File(['office'], name))
  const result = await proxyConversionRequest(
    new Request(`${origin}/api/gotenberg/convert`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenberg-Url': backend },
      body: data,
    }),
    upstream.fetcher,
  )
  assert.equal(result.status, 400)
  assert.match(await result.text(), /PDF_DISABLE_STAGES/)
  assert.deepEqual(upstream.counts(), [1, 1])
})

test('9.3 explains PDF render pixel-limit failures and retains upstream status', async () => {
  const upstream = server(
    '9.3.0',
    () => new Response(renderBudget, { status: 400 }),
    (path, form) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'render', dpi: 900, format: 'png' },
      ])
    },
  )
  const result = await proxyConversionRequest(
    request('render-pages', { dpi: '900', format: 'png' }),
    upstream.fetcher,
  )
  assert.equal(result.status, 400)
  assert.match(await result.text(), /5100 x 6600 pixels exceeds the server limit of 10000000/)
  // Verify that the client receives the environment variable, not a fictional form field.
  assert.match(
    describePdfUpstreamError(
      { major: 9, minor: 3, patch: 0 },
      '/forms/pdf/pipe',
      400,
      renderBudget,
    ),
    /PDF_MAX_RENDER_PIXELS/,
  )
})

test('9.3 reports disabled PDF routes without pretending that /version detects flags', async () => {
  const upstream = server(
    '9.3.0',
    () => new Response('Not Found', { status: 404 }),
    (path) => assert.equal(path, '/forms/pdf/info'),
  )
  const result = await proxyConversionRequest(request('pdf-info'), upstream.fetcher)
  assert.equal(result.status, 404)
  const detail = await result.text()
  assert.match(detail, /PDF_DISABLE_ROUTES/)
  assert.match(detail, /server supports this operation/)
})

test('9.3 preserves the new client-error status for unreadable extracted attachments', async () => {
  const detail =
    "Stage 'extract-attachments' failed on 'source.pdf': attachment 'bad.txt' cannot be decoded"
  const upstream = server(
    '9.3.0',
    () => new Response(detail, { status: 400 }),
    (path) => assert.match(path, /^\/forms\/pdf\/(?:pipe|extract-attachments)$/),
  )
  const result = await proxyConversionRequest(request('extract-attachments'), upstream.fetcher)
  assert.equal(result.status, 400)
  assert.equal(await result.text(), detail)
})

test('9.3 leaves unknown PDF errors and screenshot errors untouched', () => {
  const version = { major: 9, minor: 3, patch: 0 }
  assert.equal(
    describePdfUpstreamError(version, '/forms/pdf/render', 400, 'bad pages'),
    'bad pages',
  )
  assert.equal(
    describePdfUpstreamError(version, '/forms/chromium/screenshot/html', 400, stageDisabled),
    stageDisabled,
  )
  assert.equal(
    describePdfUpstreamError(version, '/forms/pdf/info', 401, 'Not authorised'),
    'Not authorised',
  )
})

test('Gotenberg 8 and 9.2 retain their existing error semantics', () => {
  const v8 = { major: 8, minor: 40, patch: 0 }
  const v92 = { major: 9, minor: 2, patch: 0 }
  for (const version of [v8, v92]) {
    assert.equal(
      describePdfUpstreamError(version, '/forms/chromium/convert/html', 400, stageDisabled),
      stageDisabled,
    )
    assert.equal(
      describePdfUpstreamError(version, '/forms/pdf/render', 400, renderBudget),
      renderBudget,
    )
  }
  assert.equal(describePdfUpstreamError(v8, '/forms/pdf/info', 404, 'Not Found'), 'Not Found')
  assert.equal(OPERATION_BY_ID.get('render-pages')?.path, '/forms/pdf/pipe')
})
