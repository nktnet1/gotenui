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
    /Named paper sizes require Gotenberg 9/,
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
    /not legacy remote attachments or overlays/,
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

test('v9 blocks incompatible ZIP entries and generated-file shadows before upstream conversion', async () => {
  const cases: {
    operation: string
    fields: Record<string, string | boolean>
    archive: File
    error: RegExp
  }[] = [
    {
      operation: 'pdf-pipeline',
      fields: { stages: '[{"op":"merge"}]' },
      archive: zipFixture({ 'source.pdf': '%PDF', 'readme.txt': 'not a PDF' }),
      error: /PDF pipeline requires PDFs or referenced stage assets/,
    },
    {
      operation: 'office-pdf',
      fields: {},
      archive: zipFixture({ 'book.epub': 'unsupported on v9' }),
      error: /unsupported Gotenberg 9 Office entry/,
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

test('rejects non-ZIP archive uploads, duplicates and unsupported operations at the proxy', async () => {
  const v9 = upstreamFixture('9.0.0', () => {})
  await assert.rejects(
    proxyConversionRequest(
      requestFor('office-pdf', {}, {}, [], [], [], [new File(['text'], 'wrong.txt')]),
      v9.fetcher,
    ),
    /must use the .zip extension/,
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
    /At most 10 ZIP archives/,
  )
  assert.deepEqual(v9.counts(), { probes: 2, conversions: 0 })
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
    /PDF pipeline requires PDFs or referenced stage assets/,
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
  const stages = JSON.stringify([
    { op: 'rotate', angle: 90 },
    { op: 'render', pages: '1', format: 'png' },
  ])
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
