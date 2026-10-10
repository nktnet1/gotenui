import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, inject, test } from 'vitest'
import { proxyConversionRequest, proxyStatusRequest } from '../../src/lib/gotenberg-proxy.server.ts'
import { OPERATIONS, type Operation, operationDefaults } from '../../src/lib/operations.ts'
import type { ConversionPayload } from '../../src/lib/validation.ts'

const backendUrl = inject('gotenbergTestUrl')
const fixtureUrl = inject('gotenbergFixtureUrl')
const proxyOrigin = 'http://gotenui.test'
let pdfBytes: ArrayBuffer
let splitPdfBytes: ArrayBuffer
let previousAllowedUrls: string | undefined

function request(
  operation: Operation,
  overrides: Partial<ConversionPayload> = {},
  inputFiles: File[] = [],
  auxiliary: File[] = [],
): Request {
  const payload: ConversionPayload = {
    operation: operation.id,
    fields: { ...operationDefaults(operation), ...overrides.fields },
    advanced: overrides.advanced ?? {},
    ...(overrides.source ? { source: overrides.source } : {}),
  }
  const body = new FormData()
  body.set('payload', JSON.stringify(payload))
  for (const file of inputFiles) body.append('files', file, file.name)
  for (const file of auxiliary) body.append('auxiliary', file, file.name)
  return new Request(`${proxyOrigin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: proxyOrigin, 'X-Gotenberg-Url': backendUrl },
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
  previousAllowedUrls = process.env.GOTENBERG_ALLOWED_URLS
  process.env.GOTENBERG_ALLOWED_URLS = backendUrl
  const status = await proxyStatusRequest(
    new Request(`${proxyOrigin}/api/gotenberg/status?url=${encodeURIComponent(backendUrl)}`),
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
  if (previousAllowedUrls === undefined) delete process.env.GOTENBERG_ALLOWED_URLS
  else process.env.GOTENBERG_ALLOWED_URLS = previousAllowedUrls
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
