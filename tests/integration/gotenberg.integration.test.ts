import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, expect, inject, test } from 'vitest'
import {
  proxyConversionRequest,
  proxyDebugRequest,
  proxyHeadHealthRequest,
  proxyMetricsRequest,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import { OPERATIONS, type Operation, operationDefaults } from '#/lib/operations'
import { OVERLAY_KINDS, overlayUploads, type PostProcessFiles } from '#/lib/pdf-post-processing'
import type { ConversionPayload } from '#/lib/validation'
import { V9_PDF_IDS } from '#/tools/v9-pdf-config'
import type { CallbackReceipt } from './async-fixture-server'
import { retryTransientConversion } from './transient-conversion'

const backendUrl = inject('gotenbergTestUrl')
const testVersion = inject('gotenbergTestVersion')
const isV9 = testVersion === '9.0.0'
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
    ...(overrides.webhook ? { webhook: overrides.webhook } : {}),
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
    case 'flatten':
      if (isV9) fields.v9FlattenFormsOnly = true
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
      if (isV9) fields.v9OverlayAcknowledged = true
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
  const verified = await status.json()
  expect(verified).toMatchObject({ online: true })
  expect(parseGotenbergVersion(verified.version)).toEqual(parseGotenbergVersion(testVersion))

  const html = OPERATIONS.find((operation) => operation.id === 'html-pdf')
  if (!html) throw new Error('Missing HTML conversion operation')
  const response = await convert(html, true)
  if (!response.ok)
    throw new Error(`Fixture generation failed: ${response.status} ${await response.text()}`)
  pdfBytes = await response.arrayBuffer()
  expect(new TextDecoder().decode(new Uint8Array(pdfBytes).subarray(0, 5))).toBe('%PDF-')

  // Both Gotenberg versions now generate the two-page split fixture via their own merge adapter.
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
test.each(
  OPERATIONS.filter(
    (operation) =>
      !V9_PDF_IDS.has(operation.id) && (!isV9 || operation.supportedGotenbergMajors?.includes(9)),
  ),
)(
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

/** Independently inspect PDF bytes with v9's read-only endpoints rather than
 * accepting an HTTP 200 and a PDF signature as proof of a successful edit.
 */
async function inspectV9Pdf(
  route: 'info' | 'metadata' | 'bookmarks' | 'attachments',
  bytes: ArrayBuffer,
): Promise<unknown> {
  const body = new FormData()
  body.append('files', new File([bytes], 'verified.pdf', { type: 'application/pdf' }))
  const auth = Buffer.from(`${testUsername}:${testPassword}`, 'utf8').toString('base64')
  const result = await fetch(`${backendUrl}/forms/pdf/${route}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body,
  })
  if (!result.ok) {
    throw new Error(`Gotenberg 9 PDF ${route}: HTTP ${result.status}: ${await result.text()}`)
  }
  return result.json()
}

test.skipIf(!isV9)(
  'Gotenberg 9 merge and select stages produce the expected page counts',
  async () => {
    const merge = OPERATIONS.find(({ id }) => id === 'merge')
    const split = OPERATIONS.find(({ id }) => id === 'split')
    if (!merge || !split) throw new Error('Missing PDF merge/split operations')
    const merged = await proxyConversionRequest(
      request(merge, {}, [pdfFile('first.pdf'), pdfFile('second.pdf')]),
    )
    if (!merged.ok) throw new Error(`Merge: ${merged.status} ${await merged.text()}`)
    const mergedBytes = await merged.arrayBuffer()
    expect(await inspectV9Pdf('info', mergedBytes)).toMatchObject({
      'verified.pdf': { pages: 2 },
    })

    const selected = await proxyConversionRequest(
      request(split, { fields: { splitMode: 'pages', splitSpan: '2', splitUnify: true } }, [
        new File([mergedBytes], 'merged.pdf', { type: 'application/pdf' }),
      ]),
    )
    if (!selected.ok) throw new Error(`Select: ${selected.status} ${await selected.text()}`)
    expect(await inspectV9Pdf('info', await selected.arrayBuffer())).toMatchObject({
      'verified.pdf': { pages: 1 },
    })
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 metadata and bookmark writes round-trip through PDF readers',
  async () => {
    const metadata = OPERATIONS.find(({ id }) => id === 'metadata-write')
    const bookmarks = OPERATIONS.find(({ id }) => id === 'bookmarks-write')
    if (!metadata || !bookmarks) throw new Error('Missing PDF structure operations')
    const updatedMetadata = await proxyConversionRequest(
      request(metadata, { fields: { metadata: '{"Author":"Gotenui","Title":"Verified"}' } }, [
        pdfFile(),
      ]),
    )
    if (!updatedMetadata.ok)
      throw new Error(`Metadata: ${updatedMetadata.status} ${await updatedMetadata.text()}`)
    expect(await inspectV9Pdf('metadata', await updatedMetadata.arrayBuffer())).toMatchObject({
      'verified.pdf': { author: 'Gotenui', title: 'Verified' },
    })

    const updatedBookmarks = await proxyConversionRequest(
      request(bookmarks, { fields: { bookmarks: '[{"title":"Introduction","page":1}]' } }, [
        pdfFile(),
      ]),
    )
    if (!updatedBookmarks.ok)
      throw new Error(`Bookmarks: ${updatedBookmarks.status} ${await updatedBookmarks.text()}`)
    expect(await inspectV9Pdf('bookmarks', await updatedBookmarks.arrayBuffer())).toMatchObject({
      'verified.pdf': [{ title: 'Introduction', pageNumber: 1 }],
    })
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 attachment stages embed named files into the PDF',
  async () => {
    const operation = OPERATIONS.find(({ id }) => id === 'embed')
    if (!operation) throw new Error('Missing PDF embed operation')
    const embedded = await proxyConversionRequest(
      request(operation, {}, [pdfFile()], [new File(['verification'], 'verification.txt')]),
    )
    if (!embedded.ok) throw new Error(`Attach: ${embedded.status} ${await embedded.text()}`)
    const result = await inspectV9Pdf('attachments', await embedded.arrayBuffer())
    expect(JSON.stringify(result)).toContain('verification.txt')
  },
  120_000,
)

/** Build a tiny AcroForm entirely in memory: no binary fixture or external dependency. */
function formPdfFixture(): File {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Annots [4 0 R] /Contents 6 0 R >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (customer) /V () /Rect [50 700 300 725] /P 3 0 R /F 4 /DA (/F1 12 Tf 0 g) >>',
    '<< /Fields [4 0 R] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 7 0 R >> >> >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let content = '%PDF-1.7\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(content.length)
    content += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const startXref = content.length
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, '0')} 00000 n \n`
  content += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`
  return new File([content], 'form.pdf', { type: 'application/pdf' })
}

async function convertV9(
  id: string,
  fields: Record<string, string | boolean> = {},
  inputs: File[] = [pdfFile()],
  assets: File[] = [],
): Promise<Response> {
  const operation = OPERATIONS.find(({ id: operationId }) => operationId === id)
  if (!operation) throw new Error(`Missing v9 tool: ${id}`)
  return proxyConversionRequest(request(operation, { fields }, inputs, assets))
}

/** Each v9 feature must use the real 9.0.0 container, not a mocked upstream. */
const v9PdfWorkflows: { id: string; fields: Record<string, string | boolean>; type: string }[] = [
  { id: 'pdf-info', fields: {}, type: 'application/json' },
  { id: 'pdf-validate', fields: { profile: 'PDF/A-2b' }, type: 'application/json' },
  { id: 'pdf-attachments', fields: {}, type: 'application/json' },
  { id: 'pdf-form', fields: {}, type: 'application/json' },
  { id: 'select-pages', fields: { pages: '2' }, type: 'application/pdf' },
  { id: 'delete-pages', fields: { pages: '1' }, type: 'application/pdf' },
  { id: 'insert-pages', fields: { at: '1' }, type: 'application/pdf' },
  { id: 'flatten-transparency', fields: {}, type: 'application/pdf' },
  { id: 'convert-colors', fields: { target: 'rgb' }, type: 'application/pdf' },
  {
    id: 'redact',
    fields: {
      regions: '[{"page":1,"x":48,"y":500,"width":50,"height":30}]',
      confirmRedaction: true,
    },
    type: 'application/pdf',
  },
  { id: 'autotag', fields: {}, type: 'application/pdf' },
  { id: 'render-pages', fields: { format: 'png', pages: '1' }, type: 'image/png' },
]

test.skipIf(!isV9).each(v9PdfWorkflows)(
  'Gotenberg 9 executes $id on real PDF content',
  async ({ id, fields, type }) => {
    const inputs = ['select-pages', 'delete-pages'].includes(id)
      ? [new File([splitPdfBytes], 'two-pages.pdf', { type: 'application/pdf' })]
      : [pdfFile()]
    const assets = id === 'insert-pages' ? [pdfFile('inserted.pdf')] : []
    const response = await convertV9(id, fields, inputs, assets)
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}: ${await response.text()}`)
    expect(response.headers.get('content-type')?.split(';')[0]).toBe(type)
    const bytes = await response.arrayBuffer()
    expect(bytes.byteLength).toBeGreaterThan(30)
    if (type === 'application/pdf') {
      expect(await inspectV9Pdf('info', bytes)).toMatchObject({
        'verified.pdf': { pages: id === 'insert-pages' ? 2 : 1 },
      })
    } else if (type === 'application/json') {
      const parsed = JSON.parse(new TextDecoder().decode(bytes))
      expect(parsed).toHaveProperty('original.pdf')
      if (id === 'pdf-validate') {
        expect(parsed['original.pdf']).toMatchObject({ profile: 'PDF/A-2b' })
        expect(typeof parsed['original.pdf'].compliant).toBe('boolean')
        expect(Array.isArray(parsed['original.pdf'].violations)).toBe(true)
      }
    } else if (type === 'image/png') {
      expect([...new Uint8Array(bytes).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 renders several pages to an image archive',
  async () => {
    const response = await convertV9('render-pages', { format: 'png' }, [
      new File([splitPdfBytes], 'two-pages.pdf', { type: 'application/pdf' }),
    ])
    if (!response.ok)
      throw new Error(`Render ZIP: HTTP ${response.status}: ${await response.text()}`)
    expect(response.headers.get('content-type')?.split(';')[0]).toBe('application/zip')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(zipEntryCount(bytes)).toBe(2)
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 fills and reads back an actual PDF form field',
  async () => {
    const source = formPdfFixture()
    const read = await convertV9('pdf-form', {}, [source])
    if (!read.ok) throw new Error(`Form read: HTTP ${read.status}: ${await read.text()}`)
    expect(JSON.stringify(await read.json())).toContain('customer')
    const filled = await convertV9('fill-form', { formValues: '{"customer":"Gotenui"}' }, [source])
    if (!filled.ok) throw new Error(`Form fill: HTTP ${filled.status}: ${await filled.text()}`)
    const updated = await convertV9('pdf-form', {}, [
      new File([await filled.arrayBuffer()], 'filled.pdf'),
    ])
    if (!updated.ok)
      throw new Error(`Form read-back: HTTP ${updated.status}: ${await updated.text()}`)
    expect(JSON.stringify(await updated.json())).toContain('Gotenui')
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 decrypts a password-protected PDF',
  async () => {
    const encrypted = await convertV9('encrypt', { userPassword: 'secret' })
    if (!encrypted.ok) throw new Error(`Encrypt: ${encrypted.status} ${await encrypted.text()}`)
    const decrypted = await convertV9('decrypt', { password: 'secret' }, [
      new File([await encrypted.arrayBuffer()], 'locked.pdf'),
    ])
    if (!decrypted.ok) throw new Error(`Decrypt: ${decrypted.status} ${await decrypted.text()}`)
    expect(await inspectV9Pdf('info', await decrypted.arrayBuffer())).toMatchObject({
      'verified.pdf': { encrypted: false, pages: 1 },
    })
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 removes an embedded attachment by name',
  async () => {
    const embedded = await convertV9(
      'embed',
      {},
      [pdfFile()],
      [new File(['proof'], 'remove-me.txt')],
    )
    if (!embedded.ok) throw new Error(`Embed: ${embedded.status} ${await embedded.text()}`)
    const cleaned = await convertV9('detach', { attachmentName: 'remove-me.txt' }, [
      new File([await embedded.arrayBuffer()], 'attached.pdf'),
    ])
    if (!cleaned.ok) throw new Error(`Detach: ${cleaned.status} ${await cleaned.text()}`)
    expect(await inspectV9Pdf('attachments', await cleaned.arrayBuffer())).toMatchObject({
      'verified.pdf': [],
    })
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 signs a PDF with an ephemeral PEM certificate',
  async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'gotenui-v9-sign-')))
    const certificate = join(temporary, 'signer.pem')
    const privateKey = join(temporary, 'signer.key')
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-sha256',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=Gotenui integration test',
          '-keyout',
          privateKey,
          '-out',
          certificate,
        ],
        { stdio: 'ignore' },
      )
      const signed = await convertV9(
        'sign',
        { reason: 'Gotenui integration' },
        [pdfFile()],
        [
          new File([readFileSync(certificate)], 'signer.pem'),
          new File([readFileSync(privateKey)], 'signer.key'),
        ],
      )
      if (!signed.ok) throw new Error(`Sign: ${signed.status} ${await signed.text()}`)
      const bytes = new Uint8Array(await signed.arrayBuffer())
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
      expect(new TextDecoder().decode(bytes).includes('/ByteRange')).toBe(true)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
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

// Multi-document routes produce ZIP rather than PDF, even though a single
// document uses the same endpoint with a PDF result.
test.each([
  { id: 'office-pdf', filenames: ['first.txt', 'second.txt'] },
  { id: 'pdfa', filenames: ['first.pdf', 'second.pdf'] },
])(
  '$id accepts multiple documents as a ZIP result',
  async ({ id, filenames }) => {
    const fields: Record<string, string> = id === 'pdfa' ? { pdfa: 'PDF/A-2b' } : {}
    const operation = OPERATIONS.find((value) => value.id === id)
    if (!operation) throw new Error(`Missing ${id} operation`)
    const files = filenames.map((name) =>
      name.endsWith('.pdf')
        ? pdfFile(name)
        : new File(['Gotenui multi-document conversion'], name, { type: 'text/plain' }),
    )
    const convertDocuments = () => proxyConversionRequest(request(operation, { fields }, files))
    // Gotenberg's PDF/A conversion can sporadically return a transient 5xx while
    // LibreOffice or the PDF engine is busy. Retry only this known flaky case,
    // without suppressing permanent failures or weakening the ZIP assertions.
    const response =
      id === 'pdfa'
        ? await retryTransientConversion(convertDocuments, {
            onRetry: ({ attempt, status, body, trace }) => {
              console.warn(
                `PDF/A multi-document attempt ${attempt} returned HTTP ${status}` +
                  `${trace ? ` (trace: ${trace})` : ''}: ${body}`,
              )
            },
          })
        : await convertDocuments()
    if (!response.ok) {
      const trace = response.headers.get('gotenberg-trace')
      throw new Error(
        `${id} multi-document conversion failed after ${id === 'pdfa' ? 'up to 3 attempts' : '1 attempt'}: ` +
          `${response.status}${trace ? ` (trace: ${trace})` : ''} ${await response.text()}`,
      )
    }
    expect(response.headers.get('content-type')?.split(';')[0]).toBe('application/zip')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe('PK')
    expect(zipEntryCount(bytes)).toBe(2)
  },
  120_000,
)

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
    await expect(
      proxyConversionRequest(
        request(operation, { source: '<!doctype html><h1>Local authenticated test</h1>' }),
      ),
    ).rejects.toMatchObject({ status: 401 })
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
  await expect(proxyConversionRequest(browser.clone())).rejects.toMatchObject({ status: 401 })
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
  await expect(proxyConversionRequest(urlOnly)).rejects.toMatchObject({ status: 401 })
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

test.skipIf(isV9)(
  'legacy Prometheus metrics are read from local Docker through the authenticated proxy',
  async () => {
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
  },
  120_000,
)

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

test.skipIf(isV9)(
  'local merge preserves displayed page order with numeric and duplicate filenames',
  async () => {
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
  },
  120_000,
)

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

test.skipIf(isV9).each(['html-pdf', 'markdown-pdf', 'office-pdf'])(
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

test.skipIf(isV9)(
  'LibreOffice conversion accepts a Factur-X CII XML attachment in the same request',
  async () => {
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
  },
  120_000,
)

test.skipIf(isV9)(
  'Gotenberg downloads a remote attachment into a new Chromium PDF',
  async () => {
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
  },
  120_000,
)

test.skipIf(isV9).each(['watermark', 'stamp'] as const)(
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

test.skipIf(isV9).each(['url-pdf', 'office-pdf'])(
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

// Runs on both pinned Gotenberg images; version-specific options use the proxy adapter.
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

/** Read the disposable host-side callback log without resolving host.docker.internal on the host. */
async function callbackReceipts(token: string, expected: (items: CallbackReceipt[]) => boolean) {
  const local = new URL(fixtureUrl)
  local.hostname = '127.0.0.1'
  local.pathname = `/_gotenui_callbacks/${token}`
  const deadline = Date.now() + 45_000
  let items: CallbackReceipt[] = []
  while (Date.now() < deadline) {
    const response = await fetch(local, { cache: 'no-store' })
    expect(response.ok).toBe(true)
    items = (await response.json()) as CallbackReceipt[]
    if (expected(items)) return items
    await sleep(200)
  }
  throw new Error(`Expected Gotenberg callback did not arrive. Received: ${JSON.stringify(items)}`)
}

function callbackUrl(token: string, kind: 'success' | 'error' | 'events' | 'retry') {
  const url = new URL(fixtureUrl)
  url.pathname = `/gotenui-callbacks/${token}/${kind}`
  return url.toString()
}

test('real downloadFrom fetches a named Office source with its per-file header', async () => {
  const office = OPERATIONS.find((operation) => operation.id === 'office-pdf')
  if (!office) throw new Error('Missing Office PDF route')
  const remote = new URL(fixtureUrl)
  remote.pathname = '/gotenui-remote/document.txt'
  const response = await proxyConversionRequest(
    request(office, {
      downloadFrom: [
        {
          url: remote.toString(),
          extraHttpHeaders: { 'X-Gotenui-Remote-Token': 'fixture-remote-key' },
        },
      ],
    }),
  )
  expect(response.status).toBe(200)
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}, 60_000)

test('real downloadFrom rejects a response without Content-Disposition filename', async () => {
  const office = OPERATIONS.find((operation) => operation.id === 'office-pdf')
  if (!office) throw new Error('Missing Office PDF route')
  const remote = new URL(fixtureUrl)
  remote.pathname = '/gotenui-remote/no-filename.txt'
  const response = await proxyConversionRequest(
    request(office, { downloadFrom: [{ url: remote.toString() }] }),
  )
  expect(response.status).toBeGreaterThanOrEqual(400)
}, 60_000)

test('real async success and events callbacks are delivered after 204 acceptance', async () => {
  const html = OPERATIONS.find((operation) => operation.id === 'html-pdf')
  if (!html) throw new Error('Missing HTML PDF route')
  const token = randomUUID()
  const trace = `fixture-success-${token}`
  const response = await proxyConversionRequest(
    request(html, {
      source: '<html><body>Async success test</body></html>',
      requestTrace: trace,
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      webhook: {
        url: callbackUrl(token, 'success'),
        method: 'PUT',
        eventsUrl: callbackUrl(token, 'events'),
        extraHttpHeaders: { 'X-Gotenui-Callback-Token': 'fixture-callback-key' },
      },
    }),
  )
  expect(response.status).toBe(204)
  expect(await response.text()).toBe('')
  const records = await callbackReceipts(
    token,
    (items) =>
      items.some((item) => item.kind === 'success') &&
      items.some((item) => item.event === 'webhook.success'),
  )
  const delivered = records.find((item) => item.kind === 'success')
  expect(delivered).toMatchObject({
    method: 'PUT',
    beginsPdf: true,
    trace,
    testHeaderPresent: true,
  })
  expect(delivered?.contentDisposition).toMatch(/filename/i)
  expect(delivered?.traceparent).toContain('0123456789abcdef0123456789abcdef')
  expect(records.find((item) => item.kind === 'events')).toMatchObject({
    method: 'POST',
    event: 'webhook.success',
  })
}, 60_000)

test.skipIf(isV9)(
  'real async failure delivers error JSON and a structured error event',
  async () => {
    const rotate = OPERATIONS.find((operation) => operation.id === 'rotate')
    if (!rotate) throw new Error('Missing rotate PDF route')
    const token = randomUUID()
    const response = await proxyConversionRequest(
      request(
        rotate,
        {
          fields: { rotateAngle: '90' },
          webhook: {
            url: callbackUrl(token, 'success'),
            errorUrl: callbackUrl(token, 'error'),
            eventsUrl: callbackUrl(token, 'events'),
          },
        },
        [new File(['not a PDF'], 'corrupt.pdf', { type: 'application/pdf' })],
      ),
    )
    expect(response.status).toBe(204)
    const records = await callbackReceipts(
      token,
      (items) =>
        items.some((item) => item.kind === 'error') &&
        items.some((item) => item.event === 'webhook.error'),
    )
    expect(records.some((item) => item.kind === 'success')).toBe(false)
    expect(records.find((item) => item.kind === 'error')).toMatchObject({
      method: 'POST',
      contentType: expect.stringContaining('application/json'),
    })
    expect(records.find((item) => item.kind === 'events')).toMatchObject({
      method: 'POST',
      event: 'webhook.error',
    })
  },
  60_000,
)

test('real async callbacks retry once after 503 and then issue a success event', async () => {
  const html = OPERATIONS.find((operation) => operation.id === 'html-pdf')
  if (!html) throw new Error('Missing HTML PDF route')
  const token = randomUUID()
  const response = await proxyConversionRequest(
    request(html, {
      source: '<html><body>Retry callback fixture</body></html>',
      webhook: { url: callbackUrl(token, 'retry'), eventsUrl: callbackUrl(token, 'events') },
    }),
  )
  expect(response.status).toBe(204)
  const records = await callbackReceipts(
    token,
    (items) =>
      items.filter((item) => item.kind === 'retry').length >= 2 &&
      items.some((item) => item.event === 'webhook.success'),
  )
  expect(records.filter((item) => item.kind === 'retry')).toHaveLength(2)
  expect(records.filter((item) => item.kind === 'retry').every((item) => item.beginsPdf)).toBe(true)
}, 60_000)

test.skipIf(!isV9)(
  'Gotenberg 9 converts multiple Office files using an ordered merge stage',
  async () => {
    const office = OPERATIONS.find(({ id }) => id === 'office-pdf')
    if (!office) throw new Error('Missing Office conversion')
    const response = await proxyConversionRequest(
      request(office, { fields: { merge: true, exportBookmarks: true } }, [
        new File(['Gotenui v9 first page'], 'first.txt', { type: 'text/plain' }),
        new File(['Gotenui v9 second page'], 'second.txt', { type: 'text/plain' }),
      ]),
    )
    if (!response.ok) throw new Error(`v9 merge: ${response.status} ${await response.text()}`)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5))).toBe(
      '%PDF-',
    )
  },
  120_000,
)

test.skipIf(!isV9)(
  'Gotenberg 9 applies PDF/A remediation after Chromium conversion',
  async () => {
    const html = OPERATIONS.find(({ id }) => id === 'html-pdf')
    if (!html) throw new Error('Missing HTML conversion')
    const response = await proxyConversionRequest(
      request(html, {
        source: '<html><body><h1>PDF/A contract</h1></body></html>',
        fields: { pdfa: 'PDF/A-2b' },
      }),
    )
    if (!response.ok) throw new Error(`v9 remediation: ${response.status} ${await response.text()}`)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5))).toBe(
      '%PDF-',
    )
  },
  120_000,
)

test.skipIf(!isV9).each(['html-pdf', 'office-pdf'] as const)(
  'Gotenberg 9 accepts a named paper size on %s',
  async (operationId) => {
    const operation = OPERATIONS.find(({ id }) => id === operationId)
    if (!operation) throw new Error(`Missing ${operationId}`)
    const { overrides, files, auxiliary } = inputFor(operation)
    const response = await proxyConversionRequest(
      request(
        operation,
        { ...overrides, fields: { ...overrides.fields, paperSize: 'A4' } },
        files,
        auxiliary,
      ),
    )
    if (!response.ok) {
      throw new Error(`v9 ${operationId} paperSize: ${response.status} ${await response.text()}`)
    }
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5))).toBe(
      '%PDF-',
    )
  },
  120_000,
)
