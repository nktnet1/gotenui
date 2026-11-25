import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { conversionTextPreview, convertWithGotenberg } from '#/lib/gotenberg-client'
import { proxyConversionRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { validateAsyncInputValues } from '#/lib/validation'

const upstream = 'http://127.0.0.1:3000'
const origin = 'https://gotenui.example.test'
const pdf = new File(['%PDF-1.7\n'], 'report.pdf')
const office = new File(['document'], 'report.docx')

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function proxy(
  candidate: Record<string, unknown>,
  files: File[] = [pdf],
  output = '%PDF-1.7\n',
) {
  const body = new FormData()
  body.set('payload', JSON.stringify({ fields: {}, advanced: {}, ...candidate }))
  for (const file of files) body.append('files', file, file.name)
  let forwarded: FormData | undefined
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/version')) return new Response('9.10.0')
    assert.ok(init?.body instanceof FormData)
    forwarded = init.body
    return new Response(output, { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(
    new Request(`${origin}/api/gotenberg/convert`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
      body,
    }),
    fetcher,
  ).catch(proxyErrorResponse)
  return { status: response.status, message: await response.text(), forwarded }
}

const editorContext = {
  localAssetNames: [],
  archivesPresent: false,
  remoteRows: [],
  remoteJson: '',
  acknowledgedRedaction: false,
  backendVersion: '9.10.0',
}

test.each(['Title', 'Keywords', 'Author'])(
  'metadata aliases cannot silently replace %s',
  async (key) => {
    const result = await proxy({
      operation: 'metadata-write',
      fields: { metadata: JSON.stringify({ [key]: 'first', [key.toLowerCase()]: 'second' }) },
    })
    assert.equal(result.status, 400)
    assert.match(result.message, /metadata.*(?:duplicate|both|conflict)/i)
    assert.equal(result.forwarded, undefined)
  },
)

test('unsupported metadata keys cannot resolve through the object prototype', async () => {
  const result = await proxy({
    operation: 'metadata-write',
    fields: { metadata: '{"constructor":"not metadata"}' },
  })
  assert.equal(result.status, 400)
  assert.match(result.message, /cannot write.*constructor/)
  assert.equal(result.forwarded, undefined)
})

test.each(['download', 'webhook'])(
  'raw %s headers must not contain duplicate case-insensitive names',
  (kind) => {
    const descriptor = {
      url: 'https://example.test/file',
      extraHttpHeaders: { Authorization: 'Bearer first', authorization: 'Bearer second' },
    }
    assert.throws(
      () =>
        validateAsyncInputValues(
          kind === 'download' ? [descriptor] : undefined,
          kind === 'webhook' ? descriptor : undefined,
        ),
      /duplicate HTTP header name/i,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'a %s source upload cannot become an attachment through an unresolved download',
  async (operation) => {
    const file = operation === 'pdf-pipeline' ? pdf : office
    const stages = JSON.stringify([{ op: 'attach', file: file.name }])
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: [{ url: 'https://example.test/download' }],
      },
      [file],
    )
    assert.equal(result.status, 400)
    assert.match(result.message, /source document.*stage asset/i)
    assert.equal(result.forwarded, undefined)
    assert.match(
      pdfPipelineEditorError(stages, {
        ...editorContext,
        documentNames: [file.name],
        documentKind: operation === 'pdf-pipeline' ? 'pdf' : 'office',
        remoteJson: '[{"url":"https://example.test/download"}]',
      }) ?? '',
      /source document.*stage asset/i,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'a %s inferred remote stage asset uses its actual pinned name',
  async (operation) => {
    const stages = JSON.stringify([{ op: 'attach', file: 'notes.txt' }])
    const file = operation === 'pdf-pipeline' ? pdf : office
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: [{ url: 'https://example.test/notes.txt' }],
      },
      [file],
    )
    assert.equal(result.status, 200, result.message)
    assert.deepEqual(JSON.parse(String(result.forwarded?.get('downloadFrom'))), [
      { url: 'https://example.test/notes.txt', filename: 'notes.txt' },
    ])
    assert.equal(
      pdfPipelineEditorError(stages, {
        ...editorContext,
        documentNames: [file.name],
        documentKind: operation === 'pdf-pipeline' ? 'pdf' : 'office',
        remoteJson: '[{"url":"https://example.test/notes.txt"}]',
      }),
      null,
    )
  },
)

test('the editor rejects unknown bookmark labels when every source filename is known', () => {
  const stages = JSON.stringify([
    { op: 'split', ranges: ['1', '2'] },
    { op: 'merge', fileBookmarks: { labels: { 'report_2.pdf': 'impossible' } } },
  ])
  assert.match(
    pdfPipelineEditorError(stages, {
      ...editorContext,
      documentNames: [pdf.name],
      documentKind: 'pdf',
    }) ?? '',
    /fileBookmarks.*name.*PDF/i,
  )
})

test('the proxy rejects impossible split bookmark labels before forwarding', async () => {
  const result = await proxy({
    operation: 'pdf-pipeline',
    fields: {
      stages: JSON.stringify([
        { op: 'split', ranges: ['1', '2'] },
        { op: 'merge', fileBookmarks: { labels: { 'report_2.pdf': 'impossible' } } },
      ]),
    },
  })
  assert.equal(result.status, 400)
  assert.match(result.message, /fileBookmarks.*name.*PDF/i)
  assert.equal(result.forwarded, undefined)
})

test('case-insensitive media types preserve Markdown result recognition', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('# Heading', {
        headers: { 'Content-Type': 'Text/Markdown; charset=utf-8' },
      }),
  )
  const result = await convertWithGotenberg(
    upstream,
    {
      operation: 'extract-text',
      fields: { format: 'markdown' },
      advanced: {},
    },
    [pdf],
    [],
    new AbortController().signal,
  )
  assert.equal(result.mode, 'download')
  if (result.mode !== 'download') throw new Error('Expected a download')
  assert.equal(result.type, 'text/markdown')
  assert.equal(result.name, 'extract-text.md')
})

test.each([
  { userStage: { op: 'encrypt', userPassword: 'test' }, error: /cannot be encrypted/ },
  { userStage: { op: 'remediate', profile: 'PDF/UA-1' }, error: /only one remediate/i },
])(
  'the editor validates generated PDF/A stages together with $userStage.op',
  ({ userStage, error }) => {
    assert.match(
      pdfPipelineEditorError(JSON.stringify([userStage]), {
        ...editorContext,
        documentKind: 'office',
        documentNames: [office.name],
        conversionFields: { pdfaProfile: 'PDF/A-2b' },
      }) ?? '',
      error,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'a pinned %s download cannot hide a missing stage asset',
  async (operation) => {
    const file = operation === 'pdf-pipeline' ? pdf : office
    const stages = JSON.stringify([{ op: 'attach', file: 'missing.txt' }])
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: [{ url: 'https://example.test/notes.txt' }],
      },
      [file],
    )
    assert.equal(result.status, 400)
    assert.match(result.message, /missing\.txt/)
    assert.equal(result.forwarded, undefined)
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'a %s generated duplicate source filename cannot become a stage asset',
  async (operation) => {
    const file = operation === 'pdf-pipeline' ? pdf : office
    const name = operation === 'pdf-pipeline' ? 'report (2).pdf' : 'report (2).docx'
    const stages = JSON.stringify([{ op: 'attach', file: name }])
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: [{ url: 'https://example.test/download' }],
      },
      [file, file],
    )
    assert.equal(result.status, 400)
    assert.match(result.message, /source document.*stage asset/i)
    assert.equal(result.forwarded, undefined)
    assert.match(
      pdfPipelineEditorError(stages, {
        ...editorContext,
        documentNames: [file.name, file.name],
        documentKind: operation === 'pdf-pipeline' ? 'pdf' : 'office',
        remoteJson: '[{"url":"https://example.test/download"}]',
      }) ?? '',
      /source document.*stage asset/i,
    )
  },
)

test.each([
  [{ nativePdfa: 'PDF/A-2a' }, /nativePdfa/],
  [{ nativePdfua: 'PDF/UA-2' }, /nativePdfua/],
  [{ nativePdfa: 'PDF/A-4', nativePdfua: 'PDF/UA-1' }, /cannot be combined/],
  [{ nativeQuality: 0 }, /nativeQuality/],
  [{ nativeQuality: 1.5 }, /nativeQuality/],
  [{ nativeMaxImageResolution: 200 }, /nativeMaxImageResolution/],
  [{ nativeWatermarkFontSize: -1 }, /nativeWatermarkFontSize/],
] as const)(
  'rejects invalid native Office settings %j before forwarding',
  async (advanced, error) => {
    const result = await proxy({ operation: 'office-pdf', advanced }, [office])
    assert.equal(result.status, 400)
    assert.match(result.message, error)
    assert.equal(result.forwarded, undefined)
  },
)

test('preserves valid explicit native Office settings', async () => {
  const advanced = {
    nativePdfa: 'PDF/A-2b',
    nativePdfua: 'PDF/UA-1',
    nativeQuality: 80,
    nativeMaxImageResolution: '150',
    nativeWatermarkFontSize: 0,
  }
  const result = await proxy({ operation: 'office-pdf', advanced }, [office])
  assert.equal(result.status, 200, result.message)
  for (const [key, value] of Object.entries(advanced)) {
    assert.equal(result.forwarded?.get(key), String(value))
  }
})

test.each([
  [{ splitMode: 'pages' }, /range or interval/],
  [{ splitSpan: '1-2' }, /split mode/i],
  [{ splitUnify: true }, /split mode/i],
  [{ splitMode: 'unknown', splitSpan: '1-2' }, /split mode/i],
  [{ splitMode: 'intervals', splitSpan: '2', splitUnify: true }, /only in pages mode/i],
] as const)(
  'rejects incomplete or contradictory Chromium split settings %j',
  async (advanced, error) => {
    const result = await proxy(
      { operation: 'url-pdf', fields: { url: 'https://example.test' }, advanced },
      [],
    )
    assert.equal(result.status, 400)
    assert.match(result.message, error)
    assert.equal(result.forwarded, undefined)
  },
)

test('translates valid Chromium Advanced JSON split settings', async () => {
  const result = await proxy(
    {
      operation: 'url-pdf',
      fields: { url: 'https://example.test' },
      advanced: { splitMode: 'pages', splitSpan: '1-3', splitUnify: 'True' },
    },
    [],
  )
  assert.equal(result.status, 200, result.message)
  assert.deepEqual(JSON.parse(String(result.forwarded?.get('stages'))), [
    { op: 'select', pages: '1-3' },
  ])
})

test.each([
  { stages: [{ op: 'rotate', angle: 90 }] },
  { stages: [{ op: 'set-metadata', title: 'Updated' }] },
  { stages: [{ op: 'merge', fileBookmarks: {} }] },
  { stages: [{ op: 'merge' }, { op: 'rotate', angle: 90 }] },
])('accepts a bounded PDF preamble after incremental stages $stages', async ({ stages }) => {
  const output = '\n%PDF-1.7\noriginal PDF with appended changes'
  const result = await proxy(
    { operation: 'pdf-pipeline', fields: { stages: JSON.stringify(stages) } },
    [pdf],
    output,
  )
  assert.equal(result.status, 200, result.message)
  assert.equal(result.message, output)
})

test('does not accept gateway HTML as incremental PDF output', async () => {
  const result = await proxy(
    { operation: 'pdf-pipeline', fields: { stages: '[{"op":"rotate","angle":90}]' } },
    [pdf],
    '<html>error %PDF-1.7</html>',
  )
  assert.equal(result.status, 502)
  assert.match(result.message, /declared file type/)
})

test('bounds Markdown text previews without treating other content as text', async () => {
  const markdown = `# Heading\n${'a'.repeat(20_000)}`
  assert.equal(
    await conversionTextPreview(new Blob([markdown]), 'text/markdown'),
    markdown.slice(0, 16_000),
  )
  assert.equal(await conversionTextPreview(new Blob(['<html>']), 'text/html'), undefined)
  assert.equal(await conversionTextPreview(pdf, 'application/pdf'), undefined)
})
