import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, inject, test } from 'vitest'
import {
  proxyConversionRequest,
  proxyDebugRequest,
  proxyHeadHealthRequest,
  proxyMetricsRequest,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'
import { OPERATIONS, type Operation, operationDefaults } from '#/lib/operations'
import { OVERLAY_KINDS, overlayUploads, type PostProcessFiles } from '#/lib/pdf-post-processing'
import type { ConversionPayload } from '#/lib/validation'

const backendUrl = inject('gotenbergTestUrl')
const fixtureUrl = inject('gotenbergFixtureUrl')
const testUsername = inject('gotenbergTestUsername')
const testPassword = inject('gotenbergTestPassword')
const proxyOrigin = 'http://gotenui.test'
let pdfBytes: ArrayBuffer
let splitPdfBytes: ArrayBuffer
const authEnvNames = [
  'GOTENBERG_ALLOWED_URLS',
  'GOTENBERG_BASIC_AUTH_URL',
  'GOTENBERG_BASIC_AUTH_USERNAME',
  'GOTENBERG_BASIC_AUTH_PASSWORD',
  'GOTENUI_SERVER_CONNECTIONS',
] as const
const previousEnv = new Map<string, string | undefined>()

function request(
  operation: Operation,
  overrides: Partial<ConversionPayload> = {},
  inputFiles: File[] = [],
  auxiliary: File[] = [],
  postFiles: PostProcessFiles = {},
): Request {
  const payload: ConversionPayload = {
    operation: operation.id,
    fields:
      (operation.id === 'watermark' && overrides.postProcess?.watermarks) ||
      (operation.id === 'stamp' && overrides.postProcess?.stamps)
        ? (overrides.fields ?? {})
        : { ...operationDefaults(operation), ...overrides.fields },
    advanced: overrides.advanced ?? {},
    ...(overrides.source ? { source: overrides.source } : {}),
    ...(overrides.markdownName ? { markdownName: overrides.markdownName } : {}),
    ...(overrides.markdownFiles ? { markdownFiles: overrides.markdownFiles } : {}),
    ...(overrides.markdownTemplate ? { markdownTemplate: overrides.markdownTemplate } : {}),
    ...(overrides.headerHtml ? { headerHtml: overrides.headerHtml } : {}),
    ...(overrides.footerHtml ? { footerHtml: overrides.footerHtml } : {}),
    ...(overrides.postProcess ? { postProcess: overrides.postProcess } : {}),
    ...(overrides.downloadFrom ? { downloadFrom: overrides.downloadFrom } : {}),
    ...(overrides.outputName ? { outputName: overrides.outputName } : {}),
    ...(overrides.requestTrace ? { requestTrace: overrides.requestTrace } : {}),
    ...(overrides.traceparent ? { traceparent: overrides.traceparent } : {}),
    ...(overrides.tracestate ? { tracestate: overrides.tracestate } : {}),
  }
  const body = new FormData()
  body.set('payload', JSON.stringify(payload))
  for (const file of inputFiles) body.append('files', file, file.name)
  for (const file of auxiliary) body.append('auxiliary', file, file.name)
  for (const kind of OVERLAY_KINDS) {
    for (const file of overlayUploads(postFiles, kind)) body.append(kind, file, file.name)
  }
  for (const file of postFiles.embeds ?? []) body.append('embeds', file, file.name)
  if (postFiles.facturxXml)
    body.append('facturxXml', postFiles.facturxXml, postFiles.facturxXml.name)
  return new Request(`${proxyOrigin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: {
      Origin: proxyOrigin,
      'X-Gotenui-Connection-Id': 'legacy-basic',
    },
    body,
  })
}

function pdfFile(name = 'original.pdf') {
  return new File([pdfBytes], name, { type: 'application/pdf' })
}

function inputFor(operation: Operation): {
  overrides: Partial<ConversionPayload>
  files: File[]
  auxiliary: File[]
} {
  const fields: Record<string, string | boolean> = {}
  const auxiliary: File[] = []
  const files: File[] = []
  let source: string | undefined
  switch (operation.input) {
    case 'url':
      fields.url = fixtureUrl
      break
    case 'html':
      source =
        '<!doctype html><html><body><h1>Gotenui local test</h1><p>HTML route.</p></body></html>'
      break
    case 'markdown':
      source = '# Gotenui local test\n\nMarkdown route.'
      break
    case 'office':
      files.push(
        new File(['Gotenui local LibreOffice conversion'], 'document.txt', { type: 'text/plain' }),
      )
      break
    case 'pdf':
      files.push(
        operation.id === 'split'
          ? new File([splitPdfBytes], 'two-pages.pdf', { type: 'application/pdf' })
          : pdfFile(),
      )
      if (operation.id === 'merge') files.push(pdfFile('second.pdf'))
      break
  }
  switch (operation.id) {
    case 'split':
      Object.assign(fields, { splitMode: 'intervals', splitSpan: '1' })
      break
    case 'pdfa':
      fields.pdfa = 'PDF/A-2b'
      break
    case 'rotate':
      fields.rotateAngle = '90'
      break
    case 'encrypt':
      fields.userPassword = 'test-password-123'
      break
    case 'metadata-write':
      fields.metadata = JSON.stringify({ Author: 'Gotenui integration' })
      break
    case 'bookmarks-write':
      fields.bookmarks = JSON.stringify([{ title: 'Local chapter', page: 1, children: [] }])
      break
    case 'watermark':
    case 'stamp':
      fields[`${operation.id}Source`] = 'text'
      fields[`${operation.id}Expression`] = 'GOTENUI TEST'
      break
    case 'embed':
      auxiliary.push(new File(['Local-only attachment'], 'notes.txt', { type: 'text/plain' }))
      break
    case 'factur-x':
      fields.facturxConformanceLevel = 'MINIMUM'
      auxiliary.push(
        new File(
          [readFileSync(new URL('./fixtures/factur-x-minimum.xml', import.meta.url), 'utf8')],
          'invoice.xml',
          { type: 'application/xml' },
        ),
      )
      break
  }
  return { overrides: { fields, source }, files, auxiliary }
}

async function convert(operation: Operation, forFixture = false): Promise<Response> {
  const { overrides, files, auxiliary } = forFixture
    ? {
        overrides: { source: '<html><body><h1>Local PDF fixture</h1></body></html>' },
        files: [],
        auxiliary: [],
      }
    : inputFor(operation)
  return proxyConversionRequest(request(operation, overrides, files, auxiliary))
}

beforeAll(async () => {
  for (const name of authEnvNames) previousEnv.set(name, process.env[name])
  process.env.GOTENBERG_ALLOWED_URLS = backendUrl
  delete process.env.GOTENUI_SERVER_CONNECTIONS
  process.env.GOTENBERG_BASIC_AUTH_URL = backendUrl
  process.env.GOTENBERG_BASIC_AUTH_USERNAME = testUsername
  process.env.GOTENBERG_BASIC_AUTH_PASSWORD = testPassword
  const status = await proxyStatusRequest(
    new Request(`${proxyOrigin}/api/gotenberg/status?connection=legacy-basic`),
  )
  expect(status.status).toBe(200)
  expect(await status.json()).toMatchObject({ online: true })

  const html = OPERATIONS.find((operation) => operation.id === 'html-pdf')
  if (!html) throw new Error('Missing HTML conversion operation')
  const response = await convert(html, true)
  if (!response.ok)
    throw new Error(`Fixture generation failed: ${response.status} ${await response.text()}`)
  pdfBytes = await response.arrayBuffer()
  expect(new TextDecoder().decode(new Uint8Array(pdfBytes).subarray(0, 5))).toBe('%PDF-')

  // Merge two single-page documents into a deterministic two-page split input.
  // Splitting the original single-page fixture returns a PDF, not a ZIP.
  const merge = OPERATIONS.find((operation) => operation.id === 'merge')
  if (!merge) throw new Error('Missing PDF merge operation')
  const merged = await proxyConversionRequest(
    request(merge, {}, [pdfFile('page-one.pdf'), pdfFile('page-two.pdf')]),
  )
  if (!merged.ok) {
    throw new Error(`Split fixture generation failed: ${merged.status} ${await merged.text()}`)
  }
  expect(merged.headers.get('content-type')).toContain('application/pdf')
  splitPdfBytes = await merged.arrayBuffer()
  expect(new TextDecoder().decode(new Uint8Array(splitPdfBytes).subarray(0, 5))).toBe('%PDF-')
}, 120_000)

afterAll(() => {
  for (const name of authEnvNames) {
    const previous = previousEnv.get(name)
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
})

function zipEntryCount(bytes: Uint8Array): number {
  // ZIP end-of-central-directory stores the number of entries at offset 10.
  // Search backwards because ZIP files can have a trailing comment.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 22 - 65_535);
    offset--
  ) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.length) return view.getUint16(offset + 10, true)
  }
  throw new Error('Missing ZIP end-of-central-directory record')
}

// Drive each UI operation through the real server-side proxy into the local Docker instance.
// No mocks and no network calls to demo.gotenberg.dev are used in this suite.
test.each(OPERATIONS)(
  '$id - $path',
  async (operation) => {
    const response = await convert(operation)
    if (!response.ok) {
      throw new Error(
        `${operation.id}: Gotenberg returned ${response.status}: ${await response.text()}`,
      )
    }
    const type = response.headers.get('content-type')?.split(';')[0]
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(10)
    switch (operation.output) {
      case 'pdf':
        expect(type).toBe('application/pdf')
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
        break
      case 'zip':
        expect(type).toBe('application/zip')
        expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe('PK')
        if (operation.id === 'split') {
          // The two-page fixture must produce two separate PDF entries, not just a ZIP header.
          expect(zipEntryCount(bytes)).toBe(2)
        }
        break
      case 'json':
        expect(type).toBe('application/json')
        expect(JSON.parse(new TextDecoder().decode(bytes))).toBeTypeOf('object')
        break
      case 'image':
        expect(type).toBe('image/png')
        expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71])
        break
    }
  },
  120_000,
)

test('the local proxy still rejects unapproved destinations', async () => {
  const operation = OPERATIONS.find((value) => value.id === 'url-pdf')
  if (!operation) throw new Error('Missing URL conversion operation')
  const original = request(operation, { fields: { url: fixtureUrl } })
  const body = await original.formData()
  const rejected = new Request(original.url, {
    method: 'POST',
    headers: { Origin: proxyOrigin, 'X-Gotenberg-Url': 'https://unapproved.example.test' },
    body,
  })
  await expect(proxyConversionRequest(rejected)).rejects.toMatchObject({ status: 403 })
})

test('a single-page split returns a PDF without an unnecessary ZIP', async () => {
  const operation = OPERATIONS.find((value) => value.id === 'split')
  if (!operation) throw new Error('Missing PDF split operation')
  const response = await proxyConversionRequest(
    request(operation, { fields: { splitMode: 'intervals', splitSpan: '1' } }, [pdfFile()]),
  )
  if (!response.ok) {
    throw new Error(`Single-page split failed: ${response.status} ${await response.text()}`)
  }
  expect(response.headers.get('content-type')?.split(';')[0]).toBe('application/pdf')
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
}, 120_000)

test('local Gotenberg protects conversions and version, but leaves health public', async () => {
  const health = await fetch(`${backendUrl}/health`)
  expect(health.status).toBe(200)
  const version = await fetch(`${backendUrl}/version`)
  expect(version.status).toBe(401)
  const form = new FormData()
  form.set('url', fixtureUrl)
  const response = await fetch(`${backendUrl}/forms/chromium/convert/url`, {
    method: 'POST',
    body: form,
    redirect: 'error',
  })
  expect(response.status).toBe(401)
})

test('HEAD health probes the local Gotenberg container without a body or demo requests', async () => {
  const direct = await fetch(`${backendUrl}/health`, { method: 'HEAD' })
  expect(direct.status).toBe(200)
  expect(await direct.text()).toBe('')

  const selected = await proxyHeadHealthRequest(
    new Request(`${proxyOrigin}/api/gotenberg/health?connection=legacy-basic`, {
      method: 'HEAD',
      headers: { Origin: proxyOrigin },
    }),
  )
  expect(selected.status).toBe(200)
  expect(selected.body).toBeNull()
  expect(await selected.text()).toBe('')
  expect(selected.headers.get('cache-control')).toBe('no-store')
  expect(selected.headers.get('x-gotenui-health-probe')).toBe('1')
  expect(selected.headers.get('authorization')).toBeNull()

  // The upstream health endpoint is public even when conversion requires Basic Auth.
  const browser = await proxyHeadHealthRequest(
    new Request(`${proxyOrigin}/api/gotenberg/health?url=${encodeURIComponent(backendUrl)}`, {
      method: 'HEAD',
      headers: { Origin: proxyOrigin },
    }),
  )
  expect(browser.status).toBe(200)
  expect(browser.body).toBeNull()

  await expect(
    proxyHeadHealthRequest(
      new Request(`${proxyOrigin}/api/gotenberg/health?url=https://unapproved.example.test`, {
        method: 'HEAD',
      }),
    ),
  ).rejects.toMatchObject({ status: 403 })
}, 120_000)

test('the proxy returns an upstream 401 when the configured Basic Auth password is wrong', async () => {
  const operation = OPERATIONS.find((value) => value.id === 'html-pdf')
  if (!operation) throw new Error('Missing HTML conversion operation')
  const originalPassword = process.env.GOTENBERG_BASIC_AUTH_PASSWORD
  process.env.GOTENBERG_BASIC_AUTH_PASSWORD = 'wrong-password'
  try {
    const status = await proxyStatusRequest(
      new Request(`${proxyOrigin}/api/gotenberg/status?connection=legacy-basic`),
    )
    expect(await status.json()).toMatchObject({
      online: false,
      error: expect.stringContaining('401'),
    })
    const response = await proxyConversionRequest(
      request(operation, { source: '<!doctype html><h1>Local authenticated test</h1>' }),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
  } finally {
    if (originalPassword === undefined) delete process.env.GOTENBERG_BASIC_AUTH_PASSWORD
    else process.env.GOTENBERG_BASIC_AUTH_PASSWORD = originalPassword
  }
})

test('browser-managed Basic Auth works against the local protected Gotenberg without server secrets', async () => {
  const operation = OPERATIONS.find((item) => item.id === 'html-pdf')
  if (!operation) throw new Error('Missing HTML operation')
  const browser = request(operation, {
    source: '<!doctype html><html><body><h1>Browser Basic Auth</h1></body></html>',
  })
  browser.headers.delete('X-Gotenui-Connection-Id')
  browser.headers.set('X-Gotenberg-Url', backendUrl)
  const unauthenticated = await proxyConversionRequest(browser.clone())
  expect(unauthenticated.status).toBe(401)
  browser.headers.set(
    'X-Gotenui-Upstream-Authorization',
    `Basic ${Buffer.from(`${testUsername}:${testPassword}`).toString('base64')}`,
  )
  const converted = await proxyConversionRequest(browser)
  expect(converted.status).toBe(200)
  expect(converted.headers.get('content-type')).toContain('application/pdf')
  expect(converted.headers.get('authorization')).toBeNull()
  expect(
    new TextDecoder().decode(new Uint8Array(await converted.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)

test('local server-managed credentials cannot be reached by supplying only the URL', async () => {
  const operation = OPERATIONS.find((item) => item.id === 'html-pdf')
  if (!operation) throw new Error('Missing HTML operation')
  const urlOnly = request(operation, { source: '<!doctype html><h1>Anonymous</h1>' })
  urlOnly.headers.delete('X-Gotenui-Connection-Id')
  urlOnly.headers.set('X-Gotenberg-Url', backendUrl)
  const response = await proxyConversionRequest(urlOnly)
  expect(response.status).toBe(401)
}, 120_000)

test('debug diagnostics return real JSON from the authenticated local Gotenberg container', async () => {
  const request = new Request(`${proxyOrigin}/api/gotenberg/debug`, {
    method: 'POST',
    headers: {
      Origin: proxyOrigin,
      'X-Gotenui-Connection-Id': 'legacy-basic',
    },
  })
  const response = await proxyDebugRequest(request)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('authorization')).toBeNull()
  const payload = await response.json()
  expect(payload).toBeTypeOf('object')
  expect(Object.keys(payload).length).toBeGreaterThan(0)

  const unauthenticated = await fetch(`${backendUrl}/debug`)
  expect(unauthenticated.status).toBe(401)
  const missingUpstreamAuth = await proxyDebugRequest(
    new Request(`${proxyOrigin}/api/gotenberg/debug`, {
      method: 'POST',
      headers: { Origin: proxyOrigin, 'X-Gotenberg-Url': backendUrl },
    }),
  )
  expect(missingUpstreamAuth.status).toBe(401)
}, 120_000)

test('legacy Prometheus metrics are read from local Docker through the authenticated proxy', async () => {
  const request = new Request(`${proxyOrigin}/api/gotenberg/metrics`, {
    method: 'POST',
    headers: {
      Origin: proxyOrigin,
      'X-Gotenui-Connection-Id': 'legacy-basic',
    },
  })
  const response = await proxyMetricsRequest(request)
  if (!response.ok) throw new Error(`Metrics failed: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('text/plain')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-gotenui-metrics')).toBe('1')
  expect(response.headers.get('authorization')).toBeNull()
  const text = await response.text()
  expect(text).toContain('# HELP ')
  expect(text).toContain('# TYPE ')
  expect(text.length).toBeGreaterThan(100)

  const missingUpstreamAuth = await proxyMetricsRequest(
    new Request(`${proxyOrigin}/api/gotenberg/metrics`, {
      method: 'POST',
      headers: { Origin: proxyOrigin, 'X-Gotenberg-Url': backendUrl },
    }),
  )
  expect(missingUpstreamAuth.status).toBe(401)
  const unapproved = request.clone()
  unapproved.headers.delete('X-Gotenui-Connection-Id')
  unapproved.headers.set('X-Gotenberg-Url', 'https://unapproved.example.test')
  await expect(proxyMetricsRequest(unapproved)).rejects.toMatchObject({ status: 403 })
}, 120_000)

/** Write a unique bookmark to the only page, so merge order can be checked in the result. */
async function bookmarkedPdf(marker: string, filename: string): Promise<File> {
  const operation = OPERATIONS.find(({ id }) => id === 'bookmarks-write')
  if (!operation) throw new Error('Missing bookmarks write operation')
  const bookmarks = JSON.stringify([{ title: marker, page: 1, children: [] }])
  const response = await proxyConversionRequest(
    request(operation, { fields: { bookmarks } }, [pdfFile(filename)]),
  )
  if (!response.ok) {
    throw new Error(`Bookmark fixture ${marker}: ${response.status} ${await response.text()}`)
  }
  return new File([await response.arrayBuffer()], filename, { type: 'application/pdf' })
}

test('local merge preserves displayed page order with numeric and duplicate filenames', async () => {
  const merge = OPERATIONS.find(({ id }) => id === 'merge')
  const read = OPERATIONS.find(({ id }) => id === 'bookmarks-read')
  if (!merge || !read) throw new Error('Merge/bookmark routes missing')
  // Gotenberg sorts raw filenames 2.pdf before z.pdf, but selected order must win.
  const files = [
    await bookmarkedPdf('z-first', 'z.pdf'),
    await bookmarkedPdf('numeric-second', '2.pdf'),
    await bookmarkedPdf('duplicate-third', 'duplicate.pdf'),
    await bookmarkedPdf('duplicate-fourth', 'duplicate.pdf'),
  ]
  const response = await proxyConversionRequest(
    request(merge, { fields: { autoIndexBookmarks: true } }, files),
  )
  if (!response.ok) throw new Error(`Merge order: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  const output = new File([await response.arrayBuffer()], 'merged.pdf', {
    type: 'application/pdf',
  })
  const readResponse = await proxyConversionRequest(request(read, {}, [output]))
  if (!readResponse.ok) {
    throw new Error(`Read merged bookmarks: ${readResponse.status} ${await readResponse.text()}`)
  }
  const result = (await readResponse.json()) as Record<
    string,
    { title: string; page: number; children?: { title: string; page: number }[] }[]
  >
  const bookmarks = Object.values(result).flat()
  expect(bookmarks.map(({ title }) => title)).toEqual([
    'z-first',
    'numeric-second',
    'duplicate-third',
    'duplicate-fourth',
  ])
  expect(bookmarks.map(({ page }) => page)).toEqual([1, 2, 3, 4])
}, 120_000)

test('real Gotenberg accepts the configured output filename, correlation ID and W3C traceparent', async () => {
  const operation = OPERATIONS.find(({ id }) => id === 'html-pdf')
  if (!operation) throw new Error('Missing HTML conversion operation')
  const response = await proxyConversionRequest(
    request(operation, {
      source: '<!doctype html><html><body>Header contract</body></html>',
      outputName: 'contract-report',
      requestTrace: 'gotenui-contract-42',
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      tracestate: 'vendor=test',
    }),
  )
  if (!response.ok) throw new Error(`Header contract: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-disposition')).toContain('contract-report.pdf')
  expect(response.headers.get('gotenberg-trace')).toBe('gotenui-contract-42')
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(response.headers.get('traceparent')).toBeNull()
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)

const chromiumHeader =
  '<html><head><style>body{font-size:10px;margin:0 12px}</style></head><body>Gotenui <span class="pageNumber"></span></body></html>'
const chromiumFooter =
  '<html><head><style>body{font-size:10px;margin:0 12px}</style></head><body>Page <span class="pageNumber"></span> of <span class="totalPages"></span></body></html>'

test.each(['url-pdf', 'html-pdf', 'markdown-pdf'])(
  'Gotenberg renders %s with custom HTML header and footer',
  async (id) => {
    const operation = OPERATIONS.find((value) => value.id === id)
    if (!operation) throw new Error(`Missing ${id}`)
    const overrides: Partial<ConversionPayload> = {
      fields: {
        ...(operation.input === 'url' ? { url: fixtureUrl } : {}),
        marginTop: '0.8',
        marginBottom: '0.8',
      },
      source:
        operation.input === 'html'
          ? '<html><body><h1>Custom HTML header test</h1></body></html>'
          : operation.input === 'markdown'
            ? '# Custom Markdown header test'
            : undefined,
      headerHtml: chromiumHeader,
      footerHtml: chromiumFooter,
    }
    const response = await proxyConversionRequest(request(operation, overrides))
    if (!response.ok) {
      throw new Error(`${id} header/footer failed: ${response.status} ${await response.text()}`)
    }
    expect(response.headers.get('content-type')).toContain('application/pdf')
    const pdf = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
  },
  120_000,
)

test.each(['markdown-pdf', 'markdown-shot'])(
  'Gotenberg renders %s with a custom template, two Markdown files and a local stylesheet',
  async (id) => {
    const operation = OPERATIONS.find((value) => value.id === id)
    if (!operation) throw new Error(`Missing ${id}`)
    const template =
      '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><h1>Gotenui</h1>{{ toHTML "chapter.md" }}{{ toHTML "intro.md" }}</body></html>'
    const response = await proxyConversionRequest(
      request(
        operation,
        {
          source: '# Intro',
          markdownName: 'intro.md',
          markdownFiles: [{ name: 'chapter.md', content: '# Chapter' }],
          markdownTemplate: template,
        },
        [],
        [new File(['body { color: navy; }'], 'theme.css', { type: 'text/css' })],
      ),
    )
    if (!response.ok) {
      throw new Error(`${id} custom template failed: ${response.status} ${await response.text()}`)
    }
    const contentType = response.headers.get('content-type')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (id === 'markdown-pdf') {
      expect(contentType).toContain('application/pdf')
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    } else {
      expect(contentType).toContain('image/png')
      expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71])
    }
  },
  120_000,
)

test.each(['html-pdf', 'markdown-pdf', 'office-pdf'])(
  '%s applies watermark/stamp plus an attachment in one conversion request',
  async (id) => {
    const operation = OPERATIONS.find((item) => item.id === id)
    if (!operation) throw new Error(`Missing ${id}`)
    const inputs = inputFor(operation)
    const response = await proxyConversionRequest(
      request(
        operation,
        {
          ...inputs.overrides,
          postProcess: {
            watermark: { source: 'text', expression: 'INTERNAL' },
            stamp: { source: 'text', expression: 'APPROVED' },
            metadata: '{"Author":"Gotenui combined processing"}',
            flatten: true,
          },
        },
        inputs.files,
        [],
        {
          embeds: [new File(['Embedded in same conversion'], 'supplement.txt')],
        },
      ),
    )
    if (!response.ok)
      throw new Error(`${id} post-processing: ${response.status} ${await response.text()}`)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(
      new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
    ).toBe('%PDF-')
  },
  120_000,
)

test('LibreOffice conversion accepts a Factur-X CII XML attachment in the same request', async () => {
  const operation = OPERATIONS.find((item) => item.id === 'office-pdf')
  if (!operation) throw new Error('Missing office-pdf')
  const xml = readFileSync(new URL('./fixtures/factur-x-minimum.xml', import.meta.url))
  const response = await proxyConversionRequest(
    request(
      operation,
      { postProcess: { facturxConformanceLevel: 'MINIMUM' } },
      [new File(['Invoice contents'], 'invoice.txt', { type: 'text/plain' })],
      [],
      { facturxXml: new File([xml], 'invoice.xml', { type: 'application/xml' }) },
    ),
  )
  if (!response.ok)
    throw new Error(`Factur-X conversion: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)

test('Gotenberg downloads a remote attachment into a new Chromium PDF', async () => {
  const operation = OPERATIONS.find((item) => item.id === 'url-pdf')
  if (!operation) throw new Error('Missing URL-to-PDF operation')
  const url = new URL('/attachment', fixtureUrl).href
  const response = await proxyConversionRequest(
    request(operation, {
      fields: { url: fixtureUrl },
      downloadFrom: [{ url, field: 'embedded' }],
    }),
  )
  if (!response.ok)
    throw new Error(`Remote attachment: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)

test.each(['watermark', 'stamp'] as const)(
  'real %s route applies ordered text, remote image and local PDF overlays',
  async (kind) => {
    const operation = OPERATIONS.find((item) => item.id === kind)
    if (!operation) throw new Error(`Missing ${kind} operation`)
    const plural = kind === 'watermark' ? 'watermarks' : 'stamps'
    const remoteUrl = new URL('/overlay.png', fixtureUrl).href
    const response = await proxyConversionRequest(
      request(
        operation,
        {
          fields: {},
          postProcess: {
            [plural]: [
              { source: 'text', expression: 'FIRST' },
              { source: 'image', expression: 'remote-overlay.png' },
              { source: 'pdf', expression: 'overlay.pdf' },
              { source: 'text', expression: 'LAST', pages: '1' },
            ],
          },
          downloadFrom: [{ url: remoteUrl, field: kind }],
        },
        [pdfFile()],
        [],
        { [kind]: [new File([pdfBytes], 'overlay.pdf', { type: 'application/pdf' })] },
      ),
    )
    if (!response.ok) {
      throw new Error(
        `${kind} ordered overlays failed: ${response.status} ${await response.text()}`,
      )
    }
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(
      new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
    ).toBe('%PDF-')
  },
  120_000,
)

test.each(['url-pdf', 'office-pdf'])(
  'real %s conversion handles repeated watermark and stamp fields together',
  async (id) => {
    const operation = OPERATIONS.find((item) => item.id === id)
    if (!operation) throw new Error(`Missing ${id} operation`)
    const inputs = inputFor(operation)
    const response = await proxyConversionRequest(
      request(
        operation,
        {
          ...inputs.overrides,
          postProcess: {
            watermarks: [
              { source: 'text', expression: 'INTERNAL' },
              { source: 'pdf', expression: 'watermark.pdf' },
            ],
            stamps: [
              { source: 'text', expression: 'APPROVED' },
              { source: 'text', expression: 'VERSION 2', pages: '1' },
            ],
          },
        },
        inputs.files,
        [],
        { watermark: [new File([pdfBytes], 'watermark.pdf', { type: 'application/pdf' })] },
      ),
    )
    if (!response.ok)
      throw new Error(`${id} repeated overlays failed: ${response.status} ${await response.text()}`)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(
      new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
    ).toBe('%PDF-')
  },
  120_000,
)

// Requires the pinned local Gotenberg 8.37 instance; intentionally excluded from Chat-mode runs.
test('Chromium accepts advanced print, wait and accessibility fields on a real conversion', async () => {
  const operation = OPERATIONS.find(({ id }) => id === 'html-pdf')
  if (!operation) throw new Error('Missing HTML conversion')
  const response = await proxyConversionRequest(
    request(operation, {
      source: '<!doctype html><html><body><h1 id="app-ready">Advanced Chromium</h1></body></html>',
      fields: {
        singlePage: true,
        preferCssPageSize: true,
        waitForSelector: '#app-ready',
        generateTaggedPdf: true,
        generateDocumentOutline: true,
      },
    }),
  )
  if (!response.ok)
    throw new Error(`Chromium advanced: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)

test('LibreOffice applies documented PDF viewer preferences to a real source file', async () => {
  const operation = OPERATIONS.find(({ id }) => id === 'office-pdf')
  if (!operation) throw new Error('Missing Office conversion')
  const response = await proxyConversionRequest(
    request(
      operation,
      {
        fields: {
          exportBookmarks: true,
          updateIndexes: true,
          exportFormFields: true,
          initialView: '1',
          initialPage: '1',
          magnification: '4',
          zoom: '125',
          pageLayout: '2',
          displayPDFDocumentTitle: true,
          hideViewerToolbar: true,
        },
      },
      [new File(['Gotenui advanced Office export'], 'document.txt', { type: 'text/plain' })],
    ),
  )
  if (!response.ok)
    throw new Error(`LibreOffice advanced: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 120_000)
