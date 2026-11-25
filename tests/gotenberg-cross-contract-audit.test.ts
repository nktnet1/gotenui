import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { conversionTextPreview, convertWithGotenberg } from '#/lib/gotenberg-client'
import { proxyConversionRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'
import { multipartBody } from '#/lib/multipart-body'
import { mapFileBookmarkLabels, validateFileBookmarks } from '#/lib/pdf-file-bookmarks'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { validateAsyncInputValues } from '#/lib/validation'
import { zipFixture } from './fixtures/zip'

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
  archives: File[] = [],
) {
  const body = new FormData()
  body.set('payload', JSON.stringify({ fields: {}, advanced: {}, ...candidate }))
  for (const file of files) body.append('files', file, file.name)
  for (const archive of archives) body.append('archives', archive, archive.name)
  let forwarded: FormData | undefined
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/version')) return new Response('9.10.0')
    assert.ok(init?.body instanceof FormData || init?.body instanceof Blob)
    forwarded = await new Request(String(url), init).formData()
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

// Standalone tools must not bypass the validation used by explicit pipelines.
test.each([
  [{ stampOptions: '{"font":"UnknownFont"}' }, /standard PDF fonts/],
  [{ stampOptions: '{"color":"red"}' }, /hexadecimal colour/],
  [{ stampOptions: '{"points":-1}' }, /font size must be positive/],
  [{ stampOptions: '{"font":"Helvetica","fontname":"Courier"}' }, /conflicting.*font/i],
] as const)('rejects invalid generated stamp options %j', async (options, error) => {
  const result = await proxy({
    operation: 'stamp',
    fields: {
      stampSource: 'text',
      stampExpression: 'DRAFT',
      v9OverlayAcknowledged: true,
      ...options,
    },
  })
  assert.equal(result.status, 400)
  assert.match(result.message, error)
  assert.equal(result.forwarded, undefined)
})

test('rejects unknown properties inside nested pipeline bookmarks', async () => {
  const stages = JSON.stringify([
    {
      op: 'set-bookmarks',
      bookmarks: [
        { title: 'Parent', pageNumber: 1, children: [{ title: 'Child', pageNumber: 1, page: 2 }] },
      ],
    },
  ])
  const result = await proxy({ operation: 'pdf-pipeline', fields: { stages } })
  assert.equal(result.status, 400)
  assert.match(result.message, /bookmark.*unknown.*page/i)
  assert.equal(result.forwarded, undefined)
  assert.match(pdfPipelineEditorError(stages, editorContext) ?? '', /bookmark.*unknown.*page/i)
})

test('accepts native null bookmark children as an empty child list', async () => {
  const result = await proxy({
    operation: 'bookmarks-write',
    fields: { bookmarks: '[{"title":"Chapter","pageNumber":1,"children":null}]' },
  })
  assert.equal(result.status, 200, result.message)
  assert.deepEqual(JSON.parse(String(result.forwarded?.get('stages'))), [
    { op: 'set-bookmarks', bookmarks: [{ title: 'Chapter', pageNumber: 1 }] },
  ])
})

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'a remote-only %s pins inferred named stage assets and earlier downloads',
  async (operation) => {
    const name = operation === 'pdf-pipeline' ? 'source.pdf' : 'source.docx'
    const stages = JSON.stringify([{ op: 'attach', file: 'notes.txt' }])
    const remotes = [
      { url: `https://example.test/${name}` },
      { url: 'https://example.test/notes.txt' },
    ]
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: remotes,
      },
      [],
    )
    assert.equal(result.status, 200, result.message)
    assert.deepEqual(JSON.parse(String(result.forwarded?.get('downloadFrom'))), [
      { ...remotes[0], filename: name },
      { ...remotes[1], filename: 'notes.txt' },
    ])
  },
)

test('rejects an unpredictable download before a URL-inferred remote stage asset', async () => {
  const stages = JSON.stringify([{ op: 'attach', file: 'notes.txt' }])
  const remotes = [
    { url: 'https://example.test/download?id=1' },
    { url: 'https://example.test/notes.txt' },
  ]
  const result = await proxy(
    { operation: 'pdf-pipeline', fields: { stages }, downloadFrom: remotes },
    [],
  )
  assert.equal(result.status, 400)
  assert.match(result.message, /Specify a remote filename/)
  assert.equal(result.forwarded, undefined)
  assert.match(
    pdfPipelineEditorError(stages, {
      ...editorContext,
      documentKind: 'pdf',
      remoteJson: JSON.stringify(remotes),
    }) ?? '',
    /Specify a remote filename/,
  )
})

test('standalone composition rejects an unknown named source even for a single input', async () => {
  const result = await proxy({
    operation: 'compose-pages',
    fields: { paperSize: 'A4', placements: '[{"source":"missing.pdf","sourcePage":1}]' },
  })
  assert.equal(result.status, 400)
  assert.match(result.message, /not one of the current PDF inputs/)
  assert.equal(result.forwarded, undefined)
})

test('standalone composition requires every known input to have a placement', async () => {
  const result = await proxy(
    {
      operation: 'compose-pages',
      fields: { paperSize: 'A4', placements: '[{"source":"report.pdf","sourcePage":1}]' },
    },
    [pdf, new File(['%PDF-1.7\n'], 'annex.pdf')],
  )
  assert.equal(result.status, 400)
  assert.match(result.message, /place every PDF.*annex\.pdf/)
  assert.equal(result.forwarded, undefined)
})

test('standalone merge rejects a bookmark label that cannot refer to a forwarded PDF', async () => {
  const result = await proxy(
    {
      operation: 'merge',
      fields: { v9FileBookmarks: true, v9FileBookmarkLabels: '{"missing.pdf":"Wrong document"}' },
    },
    [pdf, new File(['%PDF-1.7\n'], 'annex.pdf')],
  )
  assert.equal(result.status, 400)
  assert.match(result.message, /fileBookmarks.*name.*PDF/i)
  assert.equal(result.forwarded, undefined)
})

test('preserves literal percent escapes and quoted filenames across both multipart hops', async () => {
  const asset = new File(['asset with quote'], 'notes".txt')
  const other = new File(['different asset'], 'notes%22.txt')
  const escaped = new File(['%PDF-1.7\n'], 'report%0A.pdf')
  const stages = JSON.stringify([
    { op: 'attach', file: asset.name },
    { op: 'attach', file: other.name },
  ])
  let actualNames: string[] | undefined
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    return proxyConversionRequest(
      new Request(`${origin}/api/gotenberg/convert`, {
        ...init,
        headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
      }),
      async (url, upstreamInit) => {
        if (String(url).endsWith('/version')) return new Response('9.10.0')
        const wire = new Request(String(url), upstreamInit)
        const multipart = await wire.clone().text()
        // Go does not percent-decode ordinary filename parameters. Extended
        // parameters avoid the differing interpretations in Node and Go.
        assert.match(multipart, /filename\*=UTF-8''notes%22\.txt/)
        assert.match(multipart, /filename\*=UTF-8''notes%2522\.txt/)
        const parsed = await wire.formData()
        actualNames = parsed.getAll('files').map((file) => (file as File).name)
        assert.equal(parsed.get('stages'), stages)
        return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
      },
    ).catch(proxyErrorResponse)
  })
  const result = await convertWithGotenberg(
    upstream,
    { operation: 'pdf-pipeline', fields: { stages }, advanced: {} },
    [escaped],
    [asset, other],
    new AbortController().signal,
  )
  assert.equal(result.mode, 'download')
  assert.deepEqual(actualNames, [escaped.name, asset.name, other.name])
})

test.each(['bookmarks-write', 'pdf-pipeline'] as const)(
  'validates %s bookmark titles with Go whitespace semantics',
  async (operation) => {
    const fields = (title: string) => {
      const bookmarks = [{ title, pageNumber: 1 }]
      return operation === 'bookmarks-write'
        ? { bookmarks: JSON.stringify(bookmarks) }
        : { stages: JSON.stringify([{ op: 'set-bookmarks', bookmarks }]) }
    }
    const invalid = await proxy({ operation, fields: fields('\u0085') })
    assert.equal(invalid.status, 400)
    assert.match(invalid.message, /title/)
    const valid = await proxy({ operation, fields: fields('\ufeff') })
    assert.equal(valid.status, 200, valid.message)
  },
)

test('standalone compose preserves a valid explicit source and supports one dynamically named remote', async () => {
  const placements = '[{"source":"report.pdf","sourcePage":1}]'
  const named = await proxy({ operation: 'compose-pages', fields: { paperSize: 'A4', placements } })
  assert.equal(named.status, 200, named.message)
  assert.equal(named.forwarded?.get('placements'), placements)
  const dynamic = await proxy(
    {
      operation: 'compose-pages',
      fields: { paperSize: 'A4', placements: '[{"sourcePage":1}]' },
      downloadFrom: [{ url: 'https://example.test/download' }],
    },
    [],
  )
  assert.equal(dynamic.status, 200, dynamic.message)
})

test('standalone merge accepts labels for independently registered duplicate remote PDFs', async () => {
  const url = 'https://example.test/report.pdf'
  const result = await proxy(
    {
      operation: 'merge',
      fields: {
        v9FileBookmarks: true,
        v9FileBookmarkLabels: '{"report.pdf":"First","report (2).pdf":"Second"}',
      },
      downloadFrom: [
        { url, filename: 'report.pdf' },
        { url, filename: 'report.pdf' },
      ],
    },
    [],
  )
  assert.equal(result.status, 200, result.message)
  assert.deepEqual(JSON.parse(String(result.forwarded?.get('stages')))[0].fileBookmarks.labels, {
    'report.pdf': 'First',
    'report (2).pdf': 'Second',
  })
})

test.each([
  { files: [], archive: zipFixture({ 'report.pdf': '%PDF', 'notes.txt': 'resource' }) },
  { files: [pdf], archive: zipFixture({}) },
])(
  'standalone composition counts PDFs rather than archive resources',
  async ({ files, archive }) => {
    const placements = '[{"sourcePage":1}]'
    const result = await proxy(
      { operation: 'compose-pages', fields: { paperSize: 'A4', placements } },
      files,
      '%PDF-1.7\n',
      [archive],
    )
    assert.equal(result.status, 200, result.message)
    assert.equal(result.forwarded?.get('placements'), placements)
  },
)

test('standalone composition ignores explicitly named non-PDF downloads', async () => {
  const placements = '[{"source":"report.pdf","sourcePage":1}]'
  const result = await proxy({
    operation: 'compose-pages',
    fields: { paperSize: 'A4', placements },
    downloadFrom: [{ url: 'https://example.test/notes.txt', filename: 'notes.txt' }],
  })
  assert.equal(result.status, 200, result.message)
  assert.equal(result.forwarded?.get('placements'), placements)
})

test.each(['archive', 'remote'] as const)(
  'standalone merge refuses bookmark labels for non-PDF %s resources',
  async (kind) => {
    const result = await proxy(
      {
        operation: 'merge',
        fields: { v9FileBookmarks: true, v9FileBookmarkLabels: '{"notes.txt":"Not a PDF"}' },
        ...(kind === 'remote'
          ? { downloadFrom: [{ url: 'https://example.test/notes.txt', filename: 'notes.txt' }] }
          : {}),
      },
      [pdf],
      '%PDF-1.7\n',
      kind === 'archive' ? [zipFixture({ 'notes.txt': 'resource' })] : [],
    )
    assert.equal(result.status, 400, result.message)
    assert.match(result.message, /fileBookmarks.*name.*PDF/i)
    assert.equal(result.forwarded, undefined)
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  '%s requires a real source in addition to URL-inferred stage assets',
  async (operation) => {
    const name = operation === 'pdf-pipeline' ? 'asset.pdf' : 'asset.docx'
    const stages = JSON.stringify([{ op: 'attach', file: name }])
    const downloads = [{ url: `https://example.test/${name}` }]
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: downloads,
      },
      [],
    )
    assert.equal(result.status, 400, result.message)
    assert.match(result.message, /source (PDF|Office document)/i)
    assert.equal(result.forwarded, undefined)
    assert.match(
      pdfPipelineEditorError(stages, {
        ...editorContext,
        documentKind: operation === 'pdf-pipeline' ? 'pdf' : 'office',
        remoteJson: JSON.stringify(downloads),
      }) ?? '',
      /source (PDF|Office document)/i,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  '%s refuses explicitly named downloads with no supported source document',
  async (operation) => {
    const stages = JSON.stringify([{ op: 'merge' }])
    const downloads = [{ url: 'https://example.test/notes.zip', filename: 'notes.zip' }]
    const result = await proxy(
      {
        operation,
        ...(operation === 'pdf-pipeline' ? { fields: { stages } } : { conversionStages: stages }),
        downloadFrom: downloads,
      },
      [],
    )
    assert.equal(result.status, 400, result.message)
    assert.match(result.message, /source (PDF|Office document)/i)
    assert.equal(result.forwarded, undefined)
    assert.match(
      pdfPipelineEditorError(stages, {
        ...editorContext,
        documentKind: operation === 'pdf-pipeline' ? 'pdf' : 'office',
        remoteJson: JSON.stringify(downloads),
      }) ?? '',
      /source (PDF|Office document)/i,
    )
  },
)

test('a PDF pipeline rejects an explicitly wrong source before any filename-changing stage', async () => {
  const stages = JSON.stringify([
    { op: 'compose', paperSize: 'A4', placements: [{ source: 'missing.pdf', sourcePage: 1 }] },
  ])
  const result = await proxy({ operation: 'pdf-pipeline', fields: { stages } })
  assert.equal(result.status, 400, result.message)
  assert.match(result.message, /not one of the current PDF inputs/)
  assert.equal(result.forwarded, undefined)
  assert.match(
    pdfPipelineEditorError(stages, {
      ...editorContext,
      documentKind: 'pdf',
      documentNames: [pdf.name],
    }) ?? '',
    /not one of the current PDF inputs/,
  )
})

test('merge bookmark labels use Go whitespace semantics', () => {
  assert.throws(() => validateFileBookmarks({ labels: { 'report.pdf': '\u0085' } }), /non-blank/)
  assert.doesNotThrow(() => validateFileBookmarks({ labels: { 'report.pdf': '\ufeff' } }))
  assert.deepEqual(
    Object.entries(
      mapFileBookmarkLabels({ label: ['filename'] }, [
        { original: '\u0085.pdf', forwarded: '01_\u0085.pdf' },
        { original: '\ufeff.pdf', forwarded: '02_\ufeff.pdf' },
      ]).labels ?? {},
    ),
    [
      ['01_\u0085.pdf', '\u0085.pdf'],
      ['02_\ufeff.pdf', '\ufeff'],
    ],
  )
})

test('multipart preserves opaque field values and repeated text fields exactly', async () => {
  const form = new FormData()
  const values = ['a\nb\rc\r\nd', '\n', '\r', '', '\r\n', 'end\n']
  for (const value of values) form.append('password', value)
  form.append('files', pdf, pdf.name)
  form.append('files', new File(['other'], 'notes%22.txt'))
  const wire = await new Request(upstream, { method: 'POST', body: multipartBody(form) }).formData()
  assert.deepEqual(wire.getAll('password'), values)
  assert.deepEqual(
    wire.getAll('files').map((file) => (file as File).name),
    [pdf.name, 'notes%22.txt'],
  )
})

test('the Office proxy preserves password line endings on the actual multipart wire', async () => {
  const password = 'first\nsecond\rthird\r\nlast\n'
  const result = await proxy({ operation: 'office-pdf', fields: { password } }, [office])
  assert.equal(result.status, 200, result.message)
  assert.equal(result.forwarded?.get('password'), password)
})

test('Factur-X repair does not require the level used for replacement XML', async () => {
  const result = await proxy({
    operation: 'factur-x',
    fields: { v9FacturxRepairExisting: true },
  })
  assert.equal(result.status, 200, result.message)
  assert.deepEqual(JSON.parse(String(result.forwarded?.get('stages'))), [
    { op: 'remediate', profile: 'Factur-X' },
  ])
})

test('Factur-X still requires a conformance level outside repair mode', async () => {
  const result = await proxy({ operation: 'factur-x' })
  assert.equal(result.status, 400)
  assert.match(result.message, /conformance level is required/i)
  assert.equal(result.forwarded, undefined)
})

test.each(['1e2', '0x10', '2.0'])(
  'standalone split rejects non-decimal interval %s',
  async (splitSpan) => {
    const result = await proxy({
      operation: 'split',
      fields: { splitMode: 'intervals', splitSpan },
    })
    assert.equal(result.status, 400)
    assert.match(result.message, /positive whole number/)
    assert.equal(result.forwarded, undefined)
  },
)

test('standalone split does not silently discard interval unification', async () => {
  const result = await proxy({
    operation: 'split',
    fields: { splitMode: 'intervals', splitSpan: '2', splitUnify: true },
  })
  assert.equal(result.status, 400)
  assert.match(result.message, /only in pages mode/)
  assert.equal(result.forwarded, undefined)
})

test.each([
  ['nativeWatermarkRotation', '45deg'],
  ['nativeWatermarkRotation', 'Infinity'],
  ['nativeLosslessImageCompression', 'yes'],
  ['nativeReduceImageResolution', 'yes'],
  ['nativeBookmarks', 'yes'],
  ['nativeTaggedPdf', 'yes'],
  ['singlePage', 'yes'],
])('reject malformed native Office %s before forwarding', async (name, value) => {
  const result = await proxy({ operation: 'office-pdf', advanced: { [name]: value } }, [office])
  assert.equal(result.status, 400)
  assert.match(result.message, new RegExp(name))
  assert.equal(result.forwarded, undefined)
})

test.each([
  ['paperWidth', '-1in'],
  ['paperHeight', '12em'],
  ['marginTop', 'NaN'],
  ['marginLeft', '2in\n'],
])('reject invalid Chromium %s before forwarding', async (name, value) => {
  const result = await proxy(
    { operation: 'url-pdf', fields: { url: 'https://example.test', [name]: value } },
    [],
  )
  assert.equal(result.status, 400)
  assert.match(result.message, new RegExp(name))
  assert.equal(result.forwarded, undefined)
})

test('valid native Office boolean and hexadecimal angle spellings reach Gotenberg unchanged', async () => {
  const advanced = {
    nativeWatermarkRotation: '0x1.8p2',
    nativeLosslessImageCompression: 'TRUE',
    nativeReduceImageResolution: '0',
    nativeBookmarks: 't',
    nativeTaggedPdf: 'F',
    singlePage: '1',
  }
  const result = await proxy({ operation: 'office-pdf', advanced }, [office])
  assert.equal(result.status, 200, result.message)
  for (const [name, value] of Object.entries(advanced))
    assert.equal(result.forwarded?.get(name), value)
})

test('valid Chromium lengths including zero and native aliases reach Gotenberg unchanged', async () => {
  const fields = {
    url: 'https://example.test',
    paperWidth: '210mm',
    paperHeight: '0x1p3in',
    marginTop: '0',
    marginLeft: '1_000px',
  }
  const result = await proxy(
    { operation: 'url-pdf', fields, advanced: { nativeBookmarks: 'True' } },
    [],
  )
  assert.equal(result.status, 200, result.message)
  for (const [name, value] of Object.entries(fields))
    assert.equal(result.forwarded?.get(name), value)
  assert.equal(result.forwarded?.get('nativeBookmarks'), 'True')
})

test.each(['0x1.8p2in', '1_000pt'])(
  'composition preserves valid Go length %s on both routes',
  async (paperWidth) => {
    const stage = { op: 'compose', paperWidth, paperHeight: '8in', placements: [{ sourcePage: 1 }] }
    const standalone = await proxy({
      operation: 'compose-pages',
      fields: {
        paperWidth,
        paperHeight: stage.paperHeight,
        placements: JSON.stringify(stage.placements),
      },
    })
    assert.equal(standalone.status, 200, standalone.message)
    assert.equal(standalone.forwarded?.get('paperWidth'), paperWidth)
    const pipeline = await proxy({
      operation: 'pdf-pipeline',
      fields: { stages: JSON.stringify([stage]) },
    })
    assert.equal(pipeline.status, 200, pipeline.message)
    assert.deepEqual(JSON.parse(String(pipeline.forwarded?.get('stages'))), [stage])
  },
)

test.each(['1e-323px', ' 6in ', ' '])(
  'standalone and pipeline composition reject invalid length %j without trimming',
  async (paperWidth) => {
    const stage = { op: 'compose', paperSize: 'A4', paperWidth, placements: [{ sourcePage: 1 }] }
    for (const candidate of [
      {
        operation: 'compose-pages',
        fields: { paperSize: 'A4', paperWidth, placements: JSON.stringify(stage.placements) },
      },
      { operation: 'pdf-pipeline', fields: { stages: JSON.stringify([stage]) } },
    ]) {
      const result = await proxy(candidate)
      assert.equal(result.status, 400, result.message)
      assert.match(result.message, /positive length/)
      assert.equal(result.forwarded, undefined)
    }
  },
)

test('preserves leading BOMs in primary and stage filenames across both multipart hops', async () => {
  const source = new File(['%PDF-1.7\n'], '\ufeffreport.pdf')
  const asset = new File(['with BOM'], '\ufeffnotes.txt')
  const other = new File(['without BOM'], 'notes.txt')
  const stages = JSON.stringify([
    { op: 'attach', file: asset.name },
    { op: 'attach', file: other.name },
  ])
  let names: string[] | undefined
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    return proxyConversionRequest(
      new Request(`${origin}/api/gotenberg/convert`, {
        ...init,
        headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
      }),
      async (url, upstreamInit) => {
        if (String(url).endsWith('/version')) return new Response('9.10.0')
        const parsed = await new Request(String(url), upstreamInit).formData()
        names = parsed.getAll('files').map((file) => (file as File).name)
        assert.equal(parsed.get('stages'), stages)
        return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
      },
    ).catch(proxyErrorResponse)
  })
  const result = await convertWithGotenberg(
    upstream,
    { operation: 'pdf-pipeline', fields: { stages }, advanced: {} },
    [source],
    [asset, other],
    new AbortController().signal,
  )
  assert.equal(result.mode, 'download')
  assert.deepEqual(names, [source.name, asset.name, other.name])
})
