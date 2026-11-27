import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { zipFixture } from './fixtures/zip'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'

function requestFor(
  operation = 'html-pdf',
  fields: Record<string, string | boolean> = {},
  extra: Record<string, unknown> = {},
  files: File[] = [],
  auxiliary: File[] = [],
  stageFiles: File[] = [],
  archives: File[] = [],
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields,
      advanced: {},
      ...(operation === 'html-pdf'
        ? { source: '<html><body>Versioned request</body></html>' }
        : {}),
      ...extra,
    }),
  )
  for (const file of files) body.append('files', file, file.name)
  for (const file of auxiliary) body.append('auxiliary', file, file.name)
  for (const file of stageFiles) body.append('stageFile', file, file.name)
  for (const file of archives) body.append('archives', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function upstreamFixture(version: string, onConvert: (form: FormData, headers: Headers) => void) {
  let probes = 0
  let conversions = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) {
      probes++
      return new Response(version, { headers: { 'Content-Type': 'text/plain' } })
    }
    assert.equal(options?.method, 'POST')
    assert.ok(options?.body instanceof FormData)
    conversions++
    onConvert(options.body, new Headers(options.headers))
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  return { fetcher, counts: () => ({ probes, conversions }) }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

test('v9 PDF pipeline accepts duplicate source names across local and remote documents', async () => {
  const remote = 'https://example.test/another-report.pdf'
  const fixture = upstreamFixture('9.1.0', (form) => {
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'merge' }])
    assert.deepEqual(
      (form.getAll('files') as File[]).map((file) => file.name),
      ['report.pdf'],
    )
    // The name is only a preflight hint: Gotenberg derives it from the remote
    // response and auto-numbers repeated source filenames itself.
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [{ url: remote }])
  })
  const result = await proxyConversionRequest(
    requestFor(
      'pdf-pipeline',
      { stages: '[{"op":"merge"}]' },
      { downloadFrom: [{ url: remote, name: 'report.pdf' }] },
      [new File(['%PDF-1.7\n'], 'report.pdf', { type: 'application/pdf' })],
    ),
    fixture.fetcher,
  )
  assert.equal(result.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('probes /version for each request and changes form encoding after an upstream upgrade', async () => {
  let version = '8.40.0'
  const calls: FormData[] = []
  let probes = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input).endsWith('/version')) {
      probes++
      return new Response(version)
    }
    assert.ok(options?.body instanceof FormData)
    calls.push(options.body)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const payload = () => requestFor('html-pdf', { generateDocumentOutline: true, pdfa: 'PDF/A-2b' })
  assert.equal((await proxyConversionRequest(payload(), fetcher)).status, 200)
  assert.equal(calls[0]?.get('generateDocumentOutline'), 'true')
  assert.equal(calls[0]?.get('nativeBookmarks'), null)
  assert.equal(calls[0]?.get('pdfa'), 'PDF/A-2b')
  version = '9.0.0'
  assert.equal((await proxyConversionRequest(payload(), fetcher)).status, 200)
  assert.equal(calls[1]?.get('generateDocumentOutline'), null)
  assert.equal(calls[1]?.get('nativeBookmarks'), 'true')
  assert.equal(calls[1]?.get('pdfa'), null)
  assert.deepEqual(JSON.parse(String(calls[1]?.get('stages'))), [
    { op: 'remediate', profile: 'PDF/A-2b' },
  ])
  assert.equal(probes, 2)
  assert.equal(calls.length, 2)
})

test('v9 proxy sends final Office conformance remediation after merging and keeps native compression', async () => {
  const fixture = upstreamFixture('9.0.0', (form) => {
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [
      { op: 'merge' },
      { op: 'remediate', profile: 'PDF/A-2b' },
    ])
    assert.equal(form.has('nativePdfa'), false)
    assert.equal(form.has('pdfaProfile'), false)
    assert.equal(form.get('nativeQuality'), '65')
    assert.equal(form.get('nativeReduceImageResolution'), 'true')
    assert.equal(form.get('nativeMaxImageResolution'), '150')
    assert.equal(form.has('quality'), false)
    assert.equal(form.has('reduceImageResolution'), false)
    assert.equal(form.has('maxImageResolution'), false)
    assert.equal(form.getAll('files').length, 2)
  })
  const result = await proxyConversionRequest(
    requestFor(
      'office-pdf',
      {
        merge: true,
        pdfaProfile: 'PDF/A-2b',
        quality: '65',
        reduceImageResolution: true,
        maxImageResolution: '150',
      },
      {},
      [new File(['First'], 'first.txt'), new File(['Second'], 'second.txt')],
    ),
    fixture.fetcher,
  )
  assert.equal(result.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('v9 proxy rejects explicitly native conformance with Office post-processing before upload', async () => {
  const fixture = upstreamFixture('9.0.0', () => {
    assert.fail('The upstream must not receive incompatible native conformance settings.')
  })
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'office-pdf',
        { splitMode: 'intervals', splitSpan: '2', pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' },
        {},
        [new File(['Document'], 'document.txt')],
      ),
      fixture.fetcher,
    ),
    /requires PDF remediation/,
  )
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
})

test('rejects a Gotenberg 9-only option against v8 before forwarding conversion', async () => {
  const fixture = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', { paperSize: 'A4' }), fixture.fetcher),
    /Named paper size requires Gotenberg 9/,
  )
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
})

test('Office extensions follow the exact v8.40.0 and v9.0.0 API lists', async () => {
  const v8Files: string[] = []
  const v8 = upstreamFixture('8.40.0', (form) => {
    v8Files.push((form.get('files') as File).name)
  })
  for (const name of ['book.epub', 'legacy.sdw', 'legacy.uot']) {
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('office-pdf', {}, {}, [new File(['data'], name)]),
          v8.fetcher,
        )
      ).status,
      200,
    )
  }
  assert.deepEqual(v8Files, ['book.epub', 'legacy.sdw', 'legacy.uot'])
  assert.deepEqual(v8.counts(), { probes: 3, conversions: 3 })

  const v9Files: string[] = []
  const v9 = upstreamFixture('9.0.0', (form) => {
    v9Files.push((form.get('files') as File).name)
  })
  for (const name of ['legacy.sdw', 'legacy.uot']) {
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('office-pdf', {}, {}, [new File(['data'], name)]),
          v9.fetcher,
        )
      ).status,
      200,
    )
  }
  assert.deepEqual(v9Files, ['legacy.sdw', 'legacy.uot'])
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 2 })
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', {}, {}, [new File(['book'], 'book.epub')]),
      v9.fetcher,
    ),
    /Unsupported Office conversion input/,
  )
  assert.deepEqual(v9.counts(), { probes: 3, conversions: 2 })
})

test('v9 forwards Office ZIP archives after validation, while v8 rejects the same upload', async () => {
  const zip = zipFixture({ 'report.docx': 'document' }, 'documents.zip')
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.deepEqual(
      form.getAll('archives').map((value) => (value instanceof File ? value.name : '')),
      ['documents.zip'],
    )
    assert.equal(form.getAll('files').length, 0)
  })
  assert.equal(
    (await proxyConversionRequest(requestFor('office-pdf', {}, {}, [], [], [], [zip]), v9.fetcher))
      .status,
    200,
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })

  const v8 = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('office-pdf', {}, {}, [], [], [], [zip]), v8.fetcher),
    /require Gotenberg 9/,
  )
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
})

test.each(['html-pdf', 'markdown-pdf'])(
  'v9 %s accepts ZIP asset bundles without changing the generated index',
  async (operation) => {
    const zip = zipFixture({ 'theme.css': 'body {}' }, 'assets.zip')
    const v9 = upstreamFixture('9.0.0', (form) => {
      assert.equal((form.get('archives') as File).name, 'assets.zip')
      assert.deepEqual((form.getAll('files') as File[]).map((file) => file.name).slice(0, 1), [
        'index.html',
      ])
    })
    const extra = operation.startsWith('markdown')
      ? { source: '# Hello' }
      : { source: '<html><body>Local styles</body></html>' }
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor(operation, {}, extra, [], [], [], [zip]),
          v9.fetcher,
        )
      ).status,
      200,
    )
    assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })

    const v8 = upstreamFixture('8.40.0', () => {})
    await assert.rejects(
      proxyConversionRequest(requestFor(operation, {}, extra, [], [], [], [zip]), v8.fetcher),
      /ZIP archive inputs require Gotenberg 9/,
    )
    assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
  },
)

test('v9 accepts a ZIP response when Office archives expand to several output documents', async () => {
  const zip = zipFixture({ 'one.txt': 'first', 'two.txt': 'second' }, 'several.zip')
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) return new Response('9.0.0')
    assert.ok(options?.body instanceof FormData)
    assert.equal(options.body.getAll('archives').length, 1)
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), {
      headers: { 'Content-Type': 'application/zip' },
    })
  }
  const response = await proxyConversionRequest(
    requestFor('office-pdf', {}, {}, [], [], [], [zip]),
    fetcher,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
})

const archivedPdfZipCases: {
  name: string
  operation: string
  fields: Record<string, string | boolean>
  files: File[]
  archives: File[]
  extra: Record<string, unknown>
}[] = [
  {
    name: 'two source PDFs in one archive',
    operation: 'rotate',
    fields: { rotateAngle: '90' },
    files: [],
    archives: [zipFixture({ 'one.pdf': '%PDF-1.7\n', 'nested/two.PDF': '%PDF-1.7\n' })],
    extra: {},
  },
  {
    name: 'one local PDF and one archived PDF',
    operation: 'optimize',
    fields: {},
    files: [new File(['%PDF-1.7\n'], 'local.pdf')],
    archives: [zipFixture({ 'remote.pdf': '%PDF-1.7\n', 'readme.txt': 'notes' })],
    extra: {},
  },
  {
    name: 'one remote PDF and one archived PDF',
    operation: 'rotate',
    fields: { rotateAngle: '90' },
    files: [],
    archives: [zipFixture({ 'archived.pdf': '%PDF-1.7\n' })],
    extra: { downloadFrom: [{ url: 'https://files.example.test/remote.pdf' }] },
  },
  {
    name: 'source PDFs spread across archives',
    operation: 'optimize',
    fields: {},
    files: [],
    archives: [
      zipFixture({ 'a.pdf': '%PDF-1.7\n' }, 'first.zip'),
      zipFixture({ 'b.pdf': '%PDF-1.7\n' }, 'second.zip'),
    ],
    extra: {},
  },
  {
    name: 'v9-only form filling with two archived PDFs',
    operation: 'fill-form',
    fields: { formValues: '{"Name":"Example"}' },
    files: [],
    archives: [zipFixture({ 'first.pdf': '%PDF-1.7\n', 'second.pdf': '%PDF-1.7\n' })],
    extra: {},
  },
]

test.each(archivedPdfZipCases)(
  'v9 accepts a ZIP response for $name',
  async ({ operation, fields, files, archives, extra }) => {
    const output = zipFixture({ 'first.pdf': '%PDF-1.7\n', 'second.pdf': '%PDF-1.7\n' })
    let conversions = 0
    const fetcher: typeof fetch = async (input, options) => {
      if (String(input) === `${upstream}/version`) return new Response('9.9.0')
      conversions++
      assert.equal(String(input), `${upstream}/forms/pdf/pipe`)
      assert.ok(options?.body instanceof FormData)
      assert.equal(options.body.getAll('archives').length, archives.length)
      assert.equal(options.body.getAll('files').length, files.length)
      return new Response(await output.arrayBuffer(), {
        headers: { 'Content-Type': 'application/zip' },
      })
    }
    const response = await proxyConversionRequest(
      requestFor(operation, fields, extra, files, [], [], archives),
      fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/zip')
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      Buffer.from(await output.arrayBuffer()),
    )
    assert.equal(conversions, 1)
  },
)

test('v9 keeps single-source ZIP uploads PDF-only and rejects unrelated ZIP responses', async () => {
  const source = zipFixture({
    'document.pdf': '%PDF-1.7\n',
    'readme.txt': 'not a PDF',
    '__MACOSX/._ignored.pdf': 'macOS metadata',
  })
  const request = () => requestFor('rotate', { rotateAngle: '90' }, {}, [], [], [], [source])
  const unexpectedZip: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.9.0')
      : new Response(await source.arrayBuffer(), {
          headers: { 'Content-Type': 'application/zip' },
        })
  await assert.rejects(
    proxyConversionRequest(request(), unexpectedZip),
    /unexpected conversion response/,
  )

  const expectedPdf: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.9.0')
      : new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  const response = await proxyConversionRequest(request(), expectedPdf)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(await response.text(), '%PDF-1.7\n')
})

test('v9 merge still rejects ZIP output with multiple archived source PDFs', async () => {
  const source = zipFixture({ 'first.pdf': '%PDF-1.7\n', 'second.pdf': '%PDF-1.7\n' })
  const fetcher: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.9.0')
      : new Response(await source.arrayBuffer(), {
          headers: { 'Content-Type': 'application/zip' },
        })
  await assert.rejects(
    proxyConversionRequest(requestFor('merge', {}, {}, [], [], [], [source]), fetcher),
    /unexpected conversion response/,
  )
})

type ZipResponseCase = { operation: string; fields: Record<string, string | boolean> }

const attachmentExtractionCases: ZipResponseCase[] = [
  { operation: 'extract-attachments', fields: {} },
  { operation: 'pdf-pipeline', fields: { stages: '[{"op":"extract-attachments"}]' } },
]

test.each(attachmentExtractionCases)(
  '$operation preserves single extracted ZIP attachments even when their bytes are not a ZIP archive',
  async ({ operation, fields }) => {
    const source = new File(['%PDF-1.7\n'], 'source.pdf')
    for (const contents of ['', 'This is an arbitrary embedded attachment']) {
      const fetcher: typeof fetch = async (input) =>
        String(input) === `${upstream}/version`
          ? new Response('9.9.0')
          : new Response(contents, {
              headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="source_backup.zip"',
                'Content-Length': String(Buffer.byteLength(contents)),
              },
            })
      const response = await proxyConversionRequest(
        requestFor(operation, fields, {}, [source]),
        fetcher,
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'application/zip')
      assert.match(
        response.headers.get('content-disposition') ?? '',
        /filename="source_backup\.zip"/,
      )
      assert.equal(await response.text(), contents)
    }
  },
)

const zipSignatureCases: ZipResponseCase[] = [
  { operation: 'rotate', fields: { rotateAngle: '90' } },
  {
    operation: 'pdf-pipeline',
    fields: { stages: '[{"op":"optimize"},{"op":"extract-attachments"}]' },
  },
]

test.each(zipSignatureCases)(
  'non-extraction $operation ZIP results still require a real ZIP signature',
  async ({ operation, fields }) => {
    const source = [new File(['%PDF-1.7\n'], 'one.pdf'), new File(['%PDF-1.7\n'], 'two.pdf')]
    const fetcher: typeof fetch = async (input) =>
      String(input) === `${upstream}/version`
        ? new Response('9.9.0')
        : new Response('not a ZIP', {
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': 'attachment; filename="result.zip"',
            },
          })
    await assert.rejects(
      proxyConversionRequest(requestFor(operation, fields, {}, source), fetcher),
      /does not match its declared file type/,
    )
  },
)

test('v9 PDF pipeline forwards remote PDF URLs and uploaded source ZIPs, but v8 never forwards them', async () => {
  const archive = zipFixture({ 'source.pdf': '%PDF-1.7\n' }, 'source-pdfs.zip')
  const remote = [
    {
      url: 'https://files.example.test/second.pdf',
      extraHttpHeaders: { Authorization: 'Bearer private' },
    },
  ]
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.equal(form.get('files'), null)
    assert.equal((form.get('archives') as File).name, 'source-pdfs.zip')
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), remote)
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'merge' }])
  })
  const payload = { downloadFrom: remote }
  assert.equal(
    (
      await proxyConversionRequest(
        requestFor('pdf-pipeline', { stages: '[{"op":"merge"}]' }, payload, [], [], [], [archive]),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })

  const v8 = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('pdf-pipeline', { stages: '[{"op":"merge"}]' }, payload, [], [], [], [archive]),
      v8.fetcher,
    ),
    /not available on Gotenberg 8/,
  )
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
})

test('v9 PDF pipeline can use only remote PDF inputs, rejecting legacy destinations', async () => {
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.equal(form.getAll('files').length, 0)
    assert.equal(form.get('archives'), null)
    assert.equal(form.get('downloadFrom'), '[{"url":"https://files.example.test/source.pdf"}]')
  })
  assert.equal(
    (
      await proxyConversionRequest(
        requestFor(
          'pdf-pipeline',
          { stages: '[{"op":"optimize"}]' },
          {
            downloadFrom: [{ url: 'https://files.example.test/source.pdf' }],
          },
        ),
        v9.fetcher,
      )
    ).status,
    200,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'pdf-pipeline',
        { stages: '[{"op":"optimize"}]' },
        {
          downloadFrom: [{ url: 'https://files.example.test/source.pdf', field: 'embedded' }],
        },
        [new File(['%PDF-1.7'], 'input.pdf')],
      ),
      v9.fetcher,
    ),
    /Remote attachment and overlay destinations require named PDF pipeline files/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 1 })
})

test('v9 PDF tools reject malformed ZIPs before forwarding', async () => {
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'pdf-pipeline',
        { stages: '[{"op":"optimize"}]' },
        {},
        [],
        [],
        [],
        [new File(['not zip'], 'source.zip')],
      ),
      v9.fetcher,
    ),
    /not a ZIP file/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'rotate',
        { rotateAngle: '90' },
        {},
        [new File(['%PDF-1.7'], 'source.pdf')],
        [],
        [],
        [new File(['PK\u0003\u0004'], 'source.zip')],
      ),
      v9.fetcher,
    ),
    /the ZIP central directory is missing|not a ZIP file/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 0 })
})

test('v9 blocks unsupported ZIP sources and generated-file shadows before upstream conversion', async () => {
  const cases: {
    operation: string
    fields: Record<string, string | boolean>
    archive: File
    error: RegExp
  }[] = [
    {
      operation: 'office-pdf',
      fields: {},
      archive: zipFixture({ 'book.epub': 'unsupported on v9' }),
      error: /at least one source document/,
    },
    {
      operation: 'html-pdf',
      fields: {},
      archive: zipFixture({ 'index.html': 'injected page' }),
      error: /duplicate or reserved filename: index\.html/,
    },
  ]
  const v9 = upstreamFixture('9.0.0', () => {
    throw new Error('Rejected archives must not reach Gotenberg.')
  })
  for (const { operation, fields, archive, error } of cases) {
    await assert.rejects(
      proxyConversionRequest(requestFor(operation, fields, {}, [], [], [], [archive]), v9.fetcher),
      error,
    )
  }
  assert.deepEqual(v9.counts(), { probes: cases.length, conversions: 0 })
})

test('v9 forwards ZIP documents with unrelated resources without rejecting the archive', async () => {
  const v9 = upstreamFixture('9.1.0', (form) => {
    assert.equal(form.getAll('archives').length, 1)
  })
  for (const [operation, fields, archive] of [
    [
      'pdf-pipeline',
      { stages: '[{"op":"merge"}]' },
      zipFixture({ 'source.pdf': '%PDF', 'second.pdf': '%PDF', 'readme.txt': 'notes' }),
    ],
    ['office-pdf', {}, zipFixture({ 'report.docx': 'document', 'obsolete.epub': 'notes' })],
  ] as const) {
    const response = await proxyConversionRequest(
      requestFor(operation, fields, {}, [], [], [], [archive]),
      v9.fetcher,
    )
    assert.equal(response.status, 200)
  }
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 2 })
})

test('rejects malformed ZIP archives, duplicates and unsupported operations at the proxy', async () => {
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', {}, {}, [], [], [], [new File(['text'], 'wrong.txt')]),
      v9.fetcher,
    ),
    /the ZIP central directory is missing|not a ZIP file/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'url-pdf',
        { url: 'https://example.test' },
        {},
        [],
        [],
        [],
        [new File(['PK'], 'sources.zip')],
      ),
      v9.fetcher,
    ),
    /the ZIP central directory is missing|not a ZIP file/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor('html-pdf', {}, {}, [], [], [], [new File(['not-a-zip'], 'fake.zip')]),
      v9.fetcher,
    ),
    /is not a ZIP file/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', {}, {}, [], [], [], [new File([], 'empty.zip')]),
      v9.fetcher,
    ),
    /is empty/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'office-pdf',
        {},
        {},
        [],
        [],
        [],
        Array.from({ length: 11 }, (_, i) => new File(['PK'], `archive-${i}.zip`)),
      ),
      v9.fetcher,
    ),
    /is not a ZIP file/,
  )
  assert.deepEqual(v9.counts(), { probes: 4, conversions: 0 })
})

test('v9 accepts more than 10 small asset archives within the total request budget', async () => {
  const expected = Array.from({ length: 11 }, (_, i) => `style-${i}.css`)
  const v9 = upstreamFixture('9.1.0', (form) => {
    assert.deepEqual(
      form.getAll('archives').map((file) => (file instanceof File ? file.name : '')),
      expected.map((_, i) => `archive-${i}.zip`),
    )
  })
  assert.equal(
    (
      await proxyConversionRequest(
        requestFor(
          'html-pdf',
          {},
          {},
          [],
          [],
          [],
          expected.map((name, i) => zipFixture({ [name]: `/* ${i} */` }, `archive-${i}.zip`)),
        ),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })
})

test('routes migrated PDF tools on v9, and still rejects unsupported majors', async () => {
  const source = new File(['%PDF-1.7\n'], 'input.pdf', { type: 'application/pdf' })
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'rotate', angle: 90 }])
    assert.equal(form.get('rotateAngle'), null)
  })
  assert.equal(
    (
      await proxyConversionRequest(
        requestFor('rotate', { rotateAngle: '90' }, {}, [source]),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })
  const unknown = upstreamFixture('10.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', {}, {}, []), unknown.fetcher),
    /Unsupported Gotenberg version/,
  )
  assert.deepEqual(unknown.counts(), { probes: 1, conversions: 0 })
})

test('rejects v9 webhook delivery on JSON inspection routes before forwarding', async () => {
  const v9 = upstreamFixture('9.0.0', () => assert.fail('Inspection webhooks are invalid.'))
  for (const operation of [
    'metadata-read',
    'bookmarks-read',
    'pdf-info',
    'pdf-validate',
    'pdf-attachments',
    'pdf-form',
  ]) {
    await assert.rejects(
      proxyConversionRequest(
        requestFor(
          operation,
          operation === 'pdf-validate' ? { profile: 'PDF/A-2b' } : {},
          {
            webhook: {
              url: 'https://hooks.example.test/result',
              eventsUrl: 'https://hooks.example.test/events',
            },
          },
          [new File(['%PDF-1.7'], 'report.pdf')],
        ),
        v9.fetcher,
      ),
      /return JSON directly and cannot deliver results through a webhook/,
      operation,
    )
  }
  assert.deepEqual(v9.counts(), { probes: 6, conversions: 0 })
})

test('forwards ZIP-based PDF pipeline assets only when their stage names match', async () => {
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.equal(form.get('stages'), '[{"op":"attach","file":"receipt.txt"}]')
    assert.equal(form.getAll('archives').length, 1)
    assert.equal(form.getAll('files').length, 1)
  })
  const stage = { fields: { stages: '[{"op":"attach","file":"receipt.txt"}]' } }
  const source = new File(['%PDF-1.7'], 'report.pdf')
  const archive = zipFixture({
    'receipt.txt': 'Receipt',
    '__MACOSX/._receipt.txt': 'ignored metadata',
  })
  assert.equal(
    (
      await proxyConversionRequest(
        requestFor('pdf-pipeline', stage.fields, {}, [source], [], [], [archive]),
        v9.fetcher,
      )
    ).status,
    200,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'pdf-pipeline',
        stage.fields,
        {},
        [source],
        [],
        [],
        [
          zipFixture({
            'other.txt': 'not referenced',
          }),
        ],
      ),
      v9.fetcher,
    ),
    /upload an additional file named "receipt.txt"/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 1 })
})

test('rejects incomplete v9 webhooks but preserves v8 callback fields', async () => {
  const base = { url: 'https://callbacks.example.test/success' }
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(requestFor('html-pdf', {}, { webhook: base }), v9.fetcher),
    /events callback URL/,
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'html-pdf',
        {},
        {
          webhook: {
            ...base,
            eventsUrl: 'https://callbacks.example.test/events',
            errorUrl: 'https://callbacks.example.test/error',
          },
        },
      ),
      v9.fetcher,
    ),
    /removed the separate webhook error callback/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 0 })

  const v8 = upstreamFixture('8.40.0', (_form, headers) => {
    assert.equal(headers.get('Gotenberg-Webhook-Url'), base.url)
    assert.equal(headers.get('Gotenberg-Webhook-Error-Url'), 'https://callbacks.example.test/error')
  })
  const reply = await proxyConversionRequest(
    requestFor(
      'html-pdf',
      {},
      { webhook: { ...base, errorUrl: 'https://callbacks.example.test/error' } },
    ),
    v8.fetcher,
  )
  assert.equal(reply.status, 200)
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 1 })
})

test('does not forward a conversion when an authenticated /version probe fails', async () => {
  let requests = 0
  const fetcher: typeof fetch = async (input) => {
    requests++
    assert.equal(String(input), `${upstream}/version`)
    return new Response('Unauthorized', { status: 401 })
  }
  await assert.rejects(
    proxyConversionRequest(requestFor(), fetcher),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 401,
  )
  assert.equal(requests, 1)
})

test('refuses v8 multipart PDF attachments on v9 before forwarding conversion', async () => {
  const original = requestFor('html-pdf')
  const body = await original.formData()
  body.append('embeds', new File(['attachment'], 'report.txt', { type: 'text/plain' }))
  const upload = new Request(original.url, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
  const fixture = upstreamFixture('9.0.0', () => {})
  await assert.rejects(proxyConversionRequest(upload, fixture.fetcher), /attach stage/)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
})

test('routes an ordered v9 PDF pipeline with named auxiliary uploads through the real proxy boundary', async () => {
  const source = new File(['%PDF-1.7\n'], 'original.pdf', { type: 'application/pdf' })
  const receipt = new File(['receipt content'], 'receipt.txt', { type: 'text/plain' })
  const stages = [
    { op: 'attach', file: 'receipt.txt' },
    { op: 'optimize' },
    { op: 'set-metadata', title: 'Done' },
  ]
  const fixture = upstreamFixture('9.0.0', (form) => {
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
    assert.deepEqual(
      form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      ['original.pdf', 'receipt.txt'],
    )
    assert.equal(form.has('auxiliary'), false)
  })
  const reply = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages: JSON.stringify(stages) }, {}, [source], [receipt]),
    fixture.fetcher,
  )
  assert.equal(reply.status, 200)
  assert.equal(reply.headers.get('content-type'), 'application/pdf')
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('accepts signed PNG output from a final v9 render stage and rejects MIME spoofing', async () => {
  const source = new File(['%PDF-1.7\n'], 'original.pdf', { type: 'application/pdf' })
  const stages = JSON.stringify([{ op: 'render', pages: '1', format: 'png' }])
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
  let routes = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) return new Response('9.0.0')
    routes++
    assert.equal(String(input), `${upstream}/forms/pdf/pipe`)
    assert.ok(options?.body instanceof FormData)
    assert.deepEqual(JSON.parse(String(options.body.get('stages'))), JSON.parse(stages))
    return new Response(png, { headers: { 'Content-Type': 'image/png' } })
  }
  const response = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages }, {}, [source]),
    fetcher,
  )
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  assert.equal(routes, 1)

  const spoofed: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.0.0')
      : new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'image/png' } })
  await assert.rejects(
    proxyConversionRequest(requestFor('pdf-pipeline', { stages }, {}, [source]), spoofed),
    /does not match its declared file type/,
  )
})

test('PDF pipeline merges local documents in selection order despite upstream filename sorting', async () => {
  const sources = [
    new File(['%PDF-1.7\nthird'], 'z-last.pdf'),
    new File(['%PDF-1.7\nfirst'], 'a-first.pdf'),
  ]
  const fixture = upstreamFixture('9.1.0', (form) => {
    assert.deepEqual(
      (form.getAll('files') as File[]).map(({ name }) => name),
      ['01_z-last.pdf', '02_a-first.pdf'],
    )
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'merge' }])
  })
  const response = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages: '[{"op":"merge"}]' }, {}, sources),
    fixture.fetcher,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('PDF pipeline after its final merge accepts one PDF but rejects a ZIP', async () => {
  const source = new File(['%PDF-1.7\n'], 'source.pdf', { type: 'application/pdf' })
  const stages = '[{"op":"split","every":1},{"op":"merge"},{"op":"optimize"}]'
  const archive = zipFixture({ 'source.pdf': '%PDF-1.7\n' })
  const unexpectedZip: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) return new Response('9.1.0')
    assert.ok(options?.body instanceof FormData)
    assert.deepEqual(JSON.parse(String(options.body.get('stages'))), JSON.parse(stages))
    return new Response(await archive.arrayBuffer(), {
      headers: { 'Content-Type': 'application/zip' },
    })
  }
  await assert.rejects(
    proxyConversionRequest(requestFor('pdf-pipeline', { stages }, {}, [source]), unexpectedZip),
    /unexpected conversion response/,
  )

  const expectedPdf: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.1.0')
      : new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  const result = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages }, {}, [source]),
    expectedPdf,
  )
  assert.equal(result.headers.get('content-type'), 'application/pdf')
  assert.equal(await result.text(), '%PDF-1.7\n')
})

test('multi-stage PDF rendering requires ZIP and rejects a successful single-image response', async () => {
  const source = new File(['%PDF-1.7\n'], 'source.pdf', { type: 'application/pdf' })
  const stages = '[{"op":"rotate","angle":90},{"op":"render","format":"png"}]'
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])
  const archive = zipFixture({ 'source.pdf': '%PDF-1.7\n', 'source_1.png': png })
  let conversions = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) return new Response('9.1.0')
    conversions++
    assert.ok(options?.body instanceof FormData)
    assert.deepEqual(JSON.parse(String(options.body.get('stages'))), JSON.parse(stages))
    return new Response(await archive.arrayBuffer(), {
      headers: { 'Content-Type': 'application/zip' },
    })
  }
  const response = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages }, {}, [source]),
    fetcher,
  )
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(await archive.arrayBuffer()),
  )
  assert.equal(conversions, 1)

  const badFetcher: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.1.0')
      : new Response(png, { headers: { 'Content-Type': 'image/png' } })
  await assert.rejects(
    proxyConversionRequest(requestFor('pdf-pipeline', { stages }, {}, [source]), badFetcher),
    /unexpected conversion response/,
  )
})

test('rejects invalid pipeline stages and incompatible v8 requests without forwarding', async () => {
  const source = new File(['%PDF-1.7\n'], 'original.pdf', { type: 'application/pdf' })
  const malformed = requestFor(
    'pdf-pipeline',
    {
      stages: JSON.stringify([{ op: 'render', format: 'png' }, { op: 'optimize' }]),
    },
    {},
    [source],
  )
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(proxyConversionRequest(malformed, v9.fetcher), /last stage/)
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 0 })

  const v8 = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('pdf-pipeline', { stages: '[{"op":"optimize"}]' }, {}, [source]),
      v8.fetcher,
    ),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
  )
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
})

test('v9 proxy sends conversion stages and their files through the authenticated request', async () => {
  const attachment = new File(['Attached receipt'], 'receipt.txt')
  const v9 = upstreamFixture('9.0.0', (form) => {
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [
      { op: 'attach', file: 'receipt.txt' },
      { op: 'set-metadata', title: 'Archived conversion' },
    ])
    assert.deepEqual(
      (form.getAll('files') as File[]).map(({ name }) => name),
      ['index.html', 'receipt.txt'],
    )
  })
  const result = await proxyConversionRequest(
    requestFor(
      'html-pdf',
      {},
      {
        conversionStages:
          '[{"op":"attach","file":"receipt.txt"},{"op":"set-metadata","title":"Archived conversion"}]',
      },
      [],
      [],
      [attachment],
    ),
    v9.fetcher,
  )
  assert.equal(result.status, 200)
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })
})

test('v8 refuses conversion stages and their uploads before forwarding anything', async () => {
  const v8 = upstreamFixture('8.40.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('html-pdf', {}, { conversionStages: '[{"op":"optimize"}]' }),
      v8.fetcher,
    ),
    /require Gotenberg 9/,
  )
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
})

test('conversion stage uploads reject duplicate and unsafe filenames before upstream submission', async () => {
  const v9 = upstreamFixture('9.0.0', () => {})
  const file = new File(['x'], 'index.html')
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'html-pdf',
        {},
        { conversionStages: '[{"op":"attach","file":"index.html"}]' },
        [],
        [],
        [file],
      ),
      v9.fetcher,
    ),
    /Duplicate filename/,
  )
  assert.deepEqual(v9.counts(), { probes: 0, conversions: 0 })
})

test('conversion stage pipelines cannot be submitted for screenshots', async () => {
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('html-shot', {}, { conversionStages: '[{"op":"optimize"}]' }),
      v9.fetcher,
    ),
    /require a PDF conversion tool/,
  )
  assert.deepEqual(v9.counts(), { probes: 0, conversions: 0 })
})

test.each([
  ['8.40.0', '9.0.0'],
  ['9.0.0', '8.40.0'],
] as const)(
  'refuses a successful conversion when /version is %s but response reports %s',
  async (probed, actual) => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('%PDF-1.7\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input))
      return String(input) === `${upstream}/version`
        ? new Response(probed)
        : new Response(source, {
            headers: { 'Content-Type': 'application/pdf', 'Gotenberg-Version': actual },
          })
    }
    await assert.rejects(proxyConversionRequest(requestFor(), fetcher), (error: unknown) => {
      assert.ok(error instanceof Error && 'status' in error)
      assert.equal(error.status, 409)
      assert.match(error.message, /changed from v[89] to v[89]/)
      return true
    })
    assert.equal(cancelled, true)
    assert.equal(calls.length, 2)
  },
)

test('rejects an invalid success version header and accepts missing or matching headers', async () => {
  for (const header of ['not-a-version', '9.0.0', null, 'v8.40.0']) {
    const fetcher: typeof fetch = async (input) =>
      String(input) === `${upstream}/version`
        ? new Response('8.40.0')
        : new Response('%PDF-1.7\n', {
            headers: {
              'Content-Type': 'application/pdf',
              ...(header !== null ? { 'Gotenberg-Version': header } : {}),
            },
          })
    if (header === 'not-a-version' || header === '9.0.0') {
      await assert.rejects(proxyConversionRequest(requestFor(), fetcher), {
        status: header === '9.0.0' ? 409 : 502,
      })
    } else {
      const response = await proxyConversionRequest(requestFor(), fetcher)
      assert.equal(response.status, 200)
      await response.body?.cancel()
    }
  }
})

test('does not acknowledge a webhook if Gotenberg upgrades after its version probe', async () => {
  const fetcher: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('8.40.0')
      : new Response(null, { status: 204, headers: { 'Gotenberg-Version': '9.0.0' } })
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'html-pdf',
        {},
        {
          webhook: { url: 'https://hooks.example.test/complete', method: 'POST' },
        },
      ),
      fetcher,
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'status' in error)
      assert.equal(error.status, 502)
      assert.match(error.message, /may already have been accepted/)
      return true
    },
  )
})

test('v9 proxy forwards large PDF pipeline JSON below the configured byte budget', async () => {
  const longStamp = 'X'.repeat(410_000)
  const stages = JSON.stringify([{ op: 'stamp-text', text: longStamp }])
  const fixture = upstreamFixture('9.1.0', (form) => {
    const received = JSON.parse(String(form.get('stages')))
    assert.deepEqual(received, [{ op: 'stamp-text', text: longStamp }])
  })
  const result = await proxyConversionRequest(
    requestFor('pdf-pipeline', { stages }, {}, [new File(['%PDF-1.7'], 'document.pdf')]),
    fixture.fetcher,
  )
  assert.equal(result.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test.each(['r\u00e9sum\u00e9', '\u5831\u544a', 'report \ud83c\udf0d'])(
  'v9 output filename forwards UTF-8 bytes to Gotenberg: %s',
  async (name) => {
    const fixture = upstreamFixture('9.9.0', (_form, headers) => {
      const bytes = headers.get('Gotenberg-Output-Filename')
      assert.ok(bytes)
      assert.equal(Buffer.from(bytes, 'latin1').toString('utf8'), name)
    })
    const reply = await proxyConversionRequest(
      requestFor('html-pdf', {}, { outputName: name }),
      fixture.fetcher,
    )
    assert.equal(reply.status, 200)
    assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
  },
)

test('v9 webhook serializes Unicode callback URLs and UTF-8 extra header values', async () => {
  const url = 'https://example.test/\u901a\u77e5'
  const eventsUrl = 'https://m\u00fcnich.example/\u5b8c\u4e86'
  const extraHttpHeaders = { 'X-Locale': '\u65e5\u672c\u8a9e' }
  const fixture = upstreamFixture('9.9.0', (_form, headers) => {
    assert.equal(
      Buffer.from(headers.get('Gotenberg-Webhook-Url') ?? '', 'latin1').toString('utf8'),
      url,
    )
    assert.equal(
      Buffer.from(headers.get('Gotenberg-Webhook-Events-Url') ?? '', 'latin1').toString('utf8'),
      eventsUrl,
    )
    const raw = headers.get('Gotenberg-Webhook-Extra-Http-Headers')
    assert.ok(raw)
    assert.deepEqual(JSON.parse(Buffer.from(raw, 'latin1').toString('utf8')), extraHttpHeaders)
  })
  const reply = await proxyConversionRequest(
    requestFor('html-pdf', {}, { webhook: { url, eventsUrl, extraHttpHeaders } }),
    fixture.fetcher,
  )
  assert.equal(reply.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('preserves all valid own remote and webhook header names on the upstream wire', async () => {
  const extraHttpHeaders = JSON.parse(
    '{"__proto__":"safe","constructor":"other","prototype":"value"}',
  )
  const downloadFrom = [
    { url: 'https://example.test/asset.css', filename: 'asset.css', extraHttpHeaders },
  ]
  const webhook = {
    url: 'https://example.test/success',
    eventsUrl: 'https://example.test/events',
    extraHttpHeaders,
  }
  const fixture = upstreamFixture('9.10.2', (form, headers) => {
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), downloadFrom)
    assert.deepEqual(
      JSON.parse(headers.get('Gotenberg-Webhook-Extra-Http-Headers') ?? ''),
      extraHttpHeaders,
    )
  })
  const response = await proxyConversionRequest(
    requestFor('html-pdf', {}, { downloadFrom, webhook }),
    fixture.fetcher,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('v8 webhook serializes Unicode success and error URLs', async () => {
  const url = 'https://m\u00fcnich.example/\u901a\u77e5'
  const errorUrl = 'https://example.test/\u5931\u6557'
  const fixture = upstreamFixture('8.40.0', (_form, headers) => {
    assert.equal(
      Buffer.from(headers.get('Gotenberg-Webhook-Url') ?? '', 'latin1').toString('utf8'),
      url,
    )
    assert.equal(
      Buffer.from(headers.get('Gotenberg-Webhook-Error-Url') ?? '', 'latin1').toString('utf8'),
      errorUrl,
    )
  })
  const reply = await proxyConversionRequest(
    requestFor('html-pdf', {}, { webhook: { url, errorUrl } }),
    fixture.fetcher,
  )
  assert.equal(reply.status, 200)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test('v9 proxy forwards punctuation in the Gotenberg output filename header', async () => {
  const name = 'Q4 & FY26 (approved)'
  const fixture = upstreamFixture('9.1.0', (_form, headers) => {
    assert.equal(headers.get('Gotenberg-Output-Filename'), name)
  })
  const result = await proxyConversionRequest(
    requestFor('html-pdf', {}, { outputName: name }),
    fixture.fetcher,
  )
  assert.equal(result.status, 200)
  assert.match(result.headers.get('content-disposition') ?? '', /Q4 & FY26 \(approved\)\.pdf/)
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test.each<{ operation: string; fields: Record<string, string | boolean> }>([
  { operation: 'merge', fields: {} },
  { operation: 'pdf-pipeline', fields: { stages: '[{"op":"merge"}]' } },
])(
  'v9 $operation accepts single-source PDF merge output with a preamble',
  async ({ operation, fields }) => {
    const source = '\n%PDF-1.7\noriginal source bytes'
    const fetcher: typeof fetch = async (input) =>
      String(input) === `${upstream}/version`
        ? new Response('9.9.0')
        : new Response(source, { headers: { 'Content-Type': 'application/pdf' } })
    const response = await proxyConversionRequest(
      requestFor(operation, fields, {}, [new File([source], 'input.pdf')]),
      fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(await response.text(), source)
  },
)

test('a rewritten PDF still requires an immediate version header', async () => {
  const source = '\n%PDF-1.7\noriginal source bytes'
  const fetcher: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.9.0')
      : new Response(source, { headers: { 'Content-Type': 'application/pdf' } })
  await assert.rejects(
    proxyConversionRequest(
      requestFor('split', { splitMode: 'pages', splitSpan: '1' }, {}, [
        new File([source], 'input.pdf'),
      ]),
      fetcher,
    ),
    /does not match its declared file type/,
  )
})

test('proxy rejects previously unguarded major-specific native Office fields', async () => {
  const fields = { pageLayout: '3', firstPageOnLeft: true }
  const file = new File(['source'], 'report.docx')
  const v9 = upstreamFixture('9.10.0', () => assert.fail('Incompatible request reached upstream'))
  await assert.rejects(
    proxyConversionRequest(requestFor('office-pdf', fields, {}, [file]), v9.fetcher),
    {
      status: 409,
      message: /First page on left requires Gotenberg 8/,
    },
  )
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 0 })
  const v8 = upstreamFixture('8.40.0', (form) => {
    assert.equal(form.get('firstPageOnLeft'), 'true')
  })
  assert.equal(
    (await proxyConversionRequest(requestFor('office-pdf', fields, {}, [file]), v8.fetcher)).status,
    200,
  )
})

test('proxy rejects migrated numeric values before forwarding', async () => {
  const v9 = upstreamFixture('9.10.0', () => assert.fail('Incompatible request reached upstream'))
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', { openBookmarkLevels: '20' }, {}, [
        new File(['source'], 'report.docx'),
      ]),
      v9.fetcher,
    ),
    { status: 409, message: /bookmark expansion/ },
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor('html-shot', { format: 'jpeg', quality: '0' }, { source: '<p>Hello</p>' }),
      v9.fetcher,
    ),
    { status: 409, message: /at least 1/ },
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 0 })
})

test.each([
  ['8.40.0', '9.10.0'],
  ['9.10.0', '9.9.0'],
  ['9.1.0', '9.2.0'],
] as const)(
  'rejects a request configured for %s when the target reports %s',
  async (expectedBackendVersion, actual) => {
    const fixture = upstreamFixture(actual, () =>
      assert.fail('An unreviewed request must not reach the conversion route.'),
    )
    await assert.rejects(
      proxyConversionRequest(
        requestFor('html-pdf', {}, { expectedBackendVersion }),
        fixture.fetcher,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'status' in error)
        assert.equal(error.status, 409)
        assert.match(error.message, /since this request was configured/)
        return true
      },
    )
    assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
  },
)

test('accepts patch updates within the configured API minor version', async () => {
  const fixture = upstreamFixture('9.10.3', (form) => {
    assert.equal(form.has('expectedBackendVersion'), false)
    assert.equal(form.has('nativeBookmarks'), true)
  })
  const response = await proxyConversionRequest(
    requestFor(
      'html-pdf',
      { generateDocumentOutline: true },
      { expectedBackendVersion: 'v9.10.0' },
    ),
    fixture.fetcher,
  )
  assert.equal(response.status, 200)
  await response.body?.cancel()
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
})

test.each(['Unknown', '10.0.0', '9', ''])(
  'rejects invalid expected version %j before probing',
  async (expectedBackendVersion) => {
    const fixture = upstreamFixture('9.10.0', () =>
      assert.fail('Invalid version must not be forwarded.'),
    )
    await assert.rejects(
      proxyConversionRequest(
        requestFor('html-pdf', {}, { expectedBackendVersion }),
        fixture.fetcher,
      ),
      /Expected backend version must be a supported Gotenberg/,
    )
    assert.deepEqual(fixture.counts(), { probes: 0, conversions: 0 })
  },
)

test.each([undefined, '9.10.0'])(
  'detects minor version drift with expectedBackendVersion=%s',
  async (expectedBackendVersion) => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('%PDF-1.7\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('/version')
        ? new Response('9.10.0')
        : new Response(source, {
            headers: { 'Content-Type': 'application/pdf', 'Gotenberg-Version': '9.9.0' },
          })
    await assert.rejects(
      proxyConversionRequest(requestFor('html-pdf', {}, { expectedBackendVersion }), fetcher),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'status' in error)
        assert.equal(error.status, 409)
        assert.match(error.message, /changed from 9\.10 to 9\.9 during conversion/)
        return true
      },
    )
    assert.equal(cancelled, true)
  },
)

test.each([undefined, '9.10.0'])(
  'accepts a response from a different patch with expectedBackendVersion=%s',
  async (expectedBackendVersion) => {
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('/version')
        ? new Response('9.10.0')
        : new Response('%PDF-1.7\n', {
            headers: { 'Content-Type': 'application/pdf', 'Gotenberg-Version': 'v9.10.2' },
          })
    const response = await proxyConversionRequest(
      requestFor('html-pdf', {}, { expectedBackendVersion }),
      fetcher,
    )
    assert.equal(response.status, 200)
    await response.body?.cancel()
  },
)

test.each([undefined, '9.10.0'])(
  'warns about possible webhook acceptance with expectedBackendVersion=%s',
  async (expectedBackendVersion) => {
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('/version')
        ? new Response('9.10.0')
        : new Response(null, { status: 202, headers: { 'Gotenberg-Version': '9.9.0' } })
    await assert.rejects(
      proxyConversionRequest(
        requestFor(
          'html-pdf',
          {},
          {
            expectedBackendVersion,
            webhook: {
              url: 'https://hooks.example.test/complete',
              eventsUrl: 'https://hooks.example.test/events',
            },
          },
        ),
        fetcher,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'status' in error)
        assert.equal(error.status, 502)
        assert.match(error.message, /may already have been accepted/)
        return true
      },
    )
  },
)

test('raw Office conformance aliases cannot be overwritten by generated profiles', async () => {
  const file = new File(['Document'], 'document.txt')
  const fixture = upstreamFixture('9.10.0', (form) => {
    assert.equal(form.get('nativePdfa'), 'PDF/A-2b')
    assert.equal(form.has('stages'), false)
  })
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'office-pdf',
        { pdfaProfile: 'PDF/A-3b' },
        {
          advanced: { nativePdfa: 'PDF/A-2b' },
        },
        [file],
      ),
      fixture.fetcher,
    ),
    /Choose either nativePdfa\/nativePdfua/,
  )
  assert.deepEqual(fixture.counts(), { probes: 1, conversions: 0 })
  const response = await proxyConversionRequest(
    requestFor(
      'office-pdf',
      {},
      {
        advanced: { nativePdfa: 'PDF/A-2b' },
      },
      [file],
    ),
    fixture.fetcher,
  )
  assert.equal(response.status, 200)
  await response.body?.cancel()
  assert.deepEqual(fixture.counts(), { probes: 2, conversions: 1 })
})

test('standalone optimization is blocked before Gotenberg 8.36 even with default settings', async () => {
  const file = new File(['%PDF-1.7\n'], 'document.pdf', { type: 'application/pdf' })
  const unsupported = upstreamFixture('8.35.9', () => {
    assert.fail('Gotenberg 8.35 does not have the standalone optimize route.')
  })
  await assert.rejects(
    proxyConversionRequest(requestFor('optimize', {}, {}, [file]), unsupported.fetcher),
    { status: 409, message: /Optimize PDFs requires Gotenberg 8\.36/ },
  )
  assert.deepEqual(unsupported.counts(), { probes: 1, conversions: 0 })
  const supported = upstreamFixture('8.36.0', (form) => {
    assert.equal((form.get('files') as File).name, file.name)
  })
  assert.equal(
    (await proxyConversionRequest(requestFor('optimize', {}, {}, [file]), supported.fetcher))
      .status,
    200,
  )
  assert.deepEqual(supported.counts(), { probes: 1, conversions: 1 })
})

test('the native LibreOffice singlePage alias is forwarded only on Gotenberg 9', async () => {
  const file = new File(['Spreadsheet'], 'report.xlsx')
  const v9 = upstreamFixture('9.10.0', (form) => {
    assert.equal(form.get('singlePage'), 'true')
    assert.equal(form.has('singlePageSheets'), false)
  })
  const candidate = () => requestFor('office-pdf', {}, { advanced: { singlePage: true } }, [file])
  assert.equal((await proxyConversionRequest(candidate(), v9.fetcher)).status, 200)
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', { singlePageSheets: false }, { advanced: { singlePage: true } }, [
        file,
      ]),
      v9.fetcher,
    ),
    /Use either singlePageSheets or singlePage, not both/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 1 })
  const v8 = upstreamFixture('8.40.0', () => {
    assert.fail('The native alias must not be sent to Gotenberg 8.')
  })
  await assert.rejects(
    proxyConversionRequest(candidate(), v8.fetcher),
    /singlePage requires Gotenberg 9/,
  )
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
})

test('Office watermark rotation precision is checked against the verified backend', async () => {
  const file = new File(['Document'], 'document.txt')
  const candidate = (angle: string) =>
    requestFor(
      'office-pdf',
      { nativeWatermarkText: 'DRAFT', nativeWatermarkRotateAngle: angle },
      {},
      [file],
    )
  const v8 = upstreamFixture('8.40.0', (form) => {
    assert.equal(form.get('nativeWatermarkRotateAngle'), '123')
    assert.equal(form.has('nativeWatermarkRotation'), false)
  })
  await assert.rejects(proxyConversionRequest(candidate('12.34'), v8.fetcher), {
    status: 409,
    message: /one decimal/i,
  })
  assert.deepEqual(v8.counts(), { probes: 1, conversions: 0 })
  assert.equal((await proxyConversionRequest(candidate('12.3'), v8.fetcher)).status, 200)
  assert.deepEqual(v8.counts(), { probes: 2, conversions: 1 })

  const v9 = upstreamFixture('9.10.0', (form) => {
    assert.equal(form.get('nativeWatermarkRotation'), '12.34')
    assert.equal(form.has('nativeWatermarkRotateAngle'), false)
  })
  assert.equal((await proxyConversionRequest(candidate('12.34'), v9.fetcher)).status, 200)
  assert.deepEqual(v9.counts(), { probes: 1, conversions: 1 })
})

test('rejects an unused pipeline upload instead of forwarding it as another input PDF', async () => {
  const fixture = upstreamFixture('9.10.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'pdf-pipeline',
        { stages: '[{"op":"merge"}]' },
        {},
        [new File(['%PDF-1.7\n'], 'report.pdf')],
        [new File(['%PDF-1.7\n'], 'removed-insert.pdf')],
      ),
      fixture.fetcher,
    ),
    /Unused PDF pipeline stage file: removed-insert\.pdf/,
  )
  assert.equal(fixture.counts().conversions, 0)
})

test.each(['8.40.0', '9.10.0'])(
  'allows duplicate Office form field names with the default exportFormFields on %s',
  async (version) => {
    const fixture = upstreamFixture(version, (form) => {
      assert.equal(form.get('allowDuplicateFieldNames'), 'true')
      assert.equal(form.has('exportFormFields'), false)
    })
    const file = new File(['Document'], 'document.txt')
    const response = await proxyConversionRequest(
      requestFor('office-pdf', { allowDuplicateFieldNames: true }, {}, [file]),
      fixture.fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(fixture.counts().conversions, 1)
    await assert.rejects(
      proxyConversionRequest(
        requestFor('office-pdf', { allowDuplicateFieldNames: true, exportFormFields: false }, {}, [
          file,
        ]),
        fixture.fetcher,
      ),
      /requires its related option to be enabled/,
    )
    assert.equal(fixture.counts().conversions, 1)
  },
)

test.each(attachmentExtractionCases)(
  '$operation accepts filename-bearing attachments with valid MIME token punctuation',
  async ({ operation, fields }) => {
    const type = 'application/vnd.example~archive'
    const fetcher: typeof fetch = async (input) =>
      String(input) === `${upstream}/version`
        ? new Response('9.10.0')
        : new Response('contents', {
            headers: {
              'Content-Type': type,
              'Content-Disposition': 'attachment; filename="example.custom"',
            },
          })
    const response = await proxyConversionRequest(
      requestFor(operation, fields, {}, [new File(['%PDF-1.7\n'], 'source.pdf')]),
      fetcher,
    )
    assert.equal(response.headers.get('content-type'), type)
    assert.equal(await response.text(), 'contents')
  },
)

test.each([undefined, '[]', '[{"op":"optimize"}]'])(
  'Office built-in merge remains PDF-only with conversion stages %s',
  async (conversionStages) => {
    const source = zipFixture({ 'first.docx': 'first', 'second.docx': 'second' })
    const fetcher: typeof fetch = async (input, options) => {
      if (String(input) === `${upstream}/version`) return new Response('9.10.0')
      assert.ok(options?.body instanceof FormData)
      assert.equal(JSON.parse(String(options.body.get('stages')))[0].op, 'merge')
      return new Response(await source.arrayBuffer(), {
        headers: { 'Content-Type': 'application/zip' },
      })
    }
    await assert.rejects(
      proxyConversionRequest(
        requestFor('office-pdf', { merge: true }, { conversionStages }, [], [], [], [source]),
        fetcher,
      ),
      /unexpected conversion response/,
    )
  },
)

test('a generated Office merge followed by a custom split still permits a ZIP', async () => {
  const source = zipFixture({ 'first.docx': 'first', 'second.docx': 'second' })
  const output = zipFixture({ 'first_1.pdf': '%PDF-1.7\n', 'first_2.pdf': '%PDF-1.7\n' })
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${upstream}/version`) return new Response('9.10.0')
    assert.ok(options?.body instanceof FormData)
    assert.deepEqual(JSON.parse(String(options.body.get('stages'))), [
      { op: 'merge' },
      { op: 'split', every: 1 },
    ])
    return new Response(await output.arrayBuffer(), {
      headers: { 'Content-Type': 'application/zip' },
    })
  }
  const response = await proxyConversionRequest(
    requestFor(
      'office-pdf',
      { merge: true },
      { conversionStages: '[{"op":"split","every":1}]' },
      [],
      [],
      [],
      [source],
    ),
    fetcher,
  )
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(await output.arrayBuffer()),
  )
})

test.each([
  ['application/*', 'attachment; filename="example.custom"'],
  ['application/vnd.example~archive', 'inline; filename="example.custom"'],
  ['application/vnd.example~archive', 'attachment'],
])('attachment extraction rejects %s with disposition %s', async (type, disposition) => {
  const fetcher: typeof fetch = async (input) =>
    String(input) === `${upstream}/version`
      ? new Response('9.10.0')
      : new Response('contents', {
          headers: { 'Content-Type': type, 'Content-Disposition': disposition },
        })
  await assert.rejects(
    proxyConversionRequest(
      requestFor('extract-attachments', {}, {}, [new File(['%PDF-1.7\n'], 'source.pdf')]),
      fetcher,
    ),
    /unexpected conversion response/,
  )
})

test.each(['8.40.0', '9.10.0'])(
  'preserves signed callback targets on Gotenberg %s',
  async (version) => {
    const url = 'HTTPS://Hooks.Example.test:443/raw/../%2e%2e/output?key=a%2fb%2Bc&sig=x+y'
    const secondaryUrl = 'https://hooks.example.test/one/%2E/two/../event?sig=%2F%2b&empty='
    const legacy = version.startsWith('8.')
    const fixture = upstreamFixture(version, (_form, headers) => {
      assert.equal(headers.get('Gotenberg-Webhook-Url'), url)
      assert.equal(
        headers.get(legacy ? 'Gotenberg-Webhook-Error-Url' : 'Gotenberg-Webhook-Events-Url'),
        secondaryUrl,
      )
    })
    const reply = await proxyConversionRequest(
      requestFor(
        'html-pdf',
        {},
        {
          webhook: { url, ...(legacy ? { errorUrl: secondaryUrl } : { eventsUrl: secondaryUrl }) },
        },
      ),
      fixture.fetcher,
    )
    assert.equal(reply.status, 200)
    assert.deepEqual(fixture.counts(), { probes: 1, conversions: 1 })
  },
)
