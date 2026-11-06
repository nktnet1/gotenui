import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { parsePdfPipeline, pipelineResponseTypes } from '#/lib/pdf-pipeline'
import { downloadFilename } from '#/lib/security'
import { type ConversionPayload, validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'
const pdf = () => new File(['%PDF-1.7\n'], 'invoice.pdf', { type: 'application/pdf' })
const zipBytes = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)])

function requestFor(
  id: string,
  fields: Record<string, string | boolean> = {},
  options: {
    files?: File[]
    stages?: string
    outputName?: string
    conversionStages?: string
  } = {},
): Request {
  const form = new FormData()
  const { files = [pdf()], stages, outputName, conversionStages } = options
  form.set(
    'payload',
    JSON.stringify({
      operation: id,
      fields: stages === undefined ? fields : { ...fields, stages },
      advanced: {},
      ...(id === 'html-pdf'
        ? { source: '<html><body><h1>Extraction fixture</h1></body></html>' }
        : {}),
      ...(outputName ? { outputName } : {}),
      ...(conversionStages ? { conversionStages } : {}),
    }),
  )
  for (const file of files) form.append('files', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body: form,
  })
}

function fixture(
  version: string,
  onConvert: (path: string, form: FormData) => Response,
): { fetcher: typeof fetch; calls: () => number } {
  let calls = 0
  const fetcher: typeof fetch = async (url, options) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    calls++
    assert.ok(options?.body instanceof FormData)
    return onConvert(String(url).slice(upstream.length), options.body)
  }
  return { fetcher, calls: () => calls }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

test.each(['extract-attachments', 'extract-text'])(
  'Gotenberg 9.0 rejects %s before contacting the conversion endpoint',
  async (id) => {
    const upstream = fixture('9.0.0', () => assert.fail('No conversion should be sent'))
    await assert.rejects(proxyConversionRequest(requestFor(id), upstream.fetcher), {
      status: 409,
      message: /requires Gotenberg 9\.1 or later/,
    })
    assert.equal(upstream.calls(), 0)
  },
)

test.each(['extract-attachments', 'extract-text'])(
  'Gotenberg 9.0 rejects %s in standalone and conversion-time pipelines',
  async (stage) => {
    const upstream = fixture('9.0.0', () => assert.fail('No conversion should be sent'))
    for (const request of [
      requestFor('pdf-pipeline', {}, { stages: JSON.stringify([{ op: stage }]) }),
      requestFor(
        'html-pdf',
        {},
        {
          files: [],
          conversionStages: JSON.stringify([{ op: stage }]),
        },
      ),
    ]) {
      await assert.rejects(proxyConversionRequest(request, upstream.fetcher), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, new RegExp(`${stage} requires Gotenberg 9\\.1`))
        return true
      })
    }
    assert.equal(upstream.calls(), 0)
  },
)

test('Gotenberg 9.1 maps attachment extraction by exact filename without trimming', async () => {
  const filename = 'invoice_résumé 日本.xml'
  const upstream = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/extract-attachments')
    assert.equal(form.get('name'), ' résumé 日本.xml ')
    assert.equal((form.get('files') as File).name, 'invoice.pdf')
    assert.equal(form.has('stages'), false)
    return new Response('<receipt>accepted</receipt>', {
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="invoice.xml"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Gotenberg-Version': '9.1.0',
      },
    })
  })
  const response = await proxyConversionRequest(
    requestFor('extract-attachments', { name: ' résumé 日本.xml ' }),
    upstream.fetcher,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/xml')
  assert.equal(downloadFilename(response.headers.get('content-disposition'), 'fallback'), filename)
  assert.equal(await response.text(), '<receipt>accepted</receipt>')
  assert.equal(upstream.calls(), 1)
})

test('Gotenberg 9.1 text extraction sends all page and text options, and accepts empty text', async () => {
  const upstream = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/extract-text')
    assert.deepEqual([...form.keys()].sort(), [
      'annotations',
      'artifacts',
      'files',
      'invisible',
      'pages',
    ])
    assert.equal(form.get('pages'), '2,odd')
    assert.equal(form.get('invisible'), 'true')
    assert.equal(form.get('artifacts'), 'true')
    assert.equal(form.get('annotations'), 'true')
    return new Response('', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': '0' },
    })
  })
  const response = await proxyConversionRequest(
    requestFor('extract-text', {
      pages: '2,odd',
      invisible: true,
      artifacts: true,
      annotations: true,
    }),
    upstream.fetcher,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(
    downloadFilename(response.headers.get('content-disposition'), ''),
    'extract-text.txt',
  )
  assert.equal(await response.text(), '')
})

test('Gotenberg 9.1 returns text from one PDF and ZIPs from multiple PDFs', async () => {
  const text = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/extract-text')
    assert.equal(form.has('pages'), false)
    return new Response('Local PDF fixture\fSecond page', {
      headers: { 'Content-Type': 'text/plain' },
    })
  })
  const plain = await proxyConversionRequest(requestFor('extract-text'), text.fetcher)
  assert.equal(plain.status, 200)
  assert.equal(await plain.text(), 'Local PDF fixture\fSecond page')

  const archive = fixture(
    '9.1.0',
    () =>
      new Response(zipBytes, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="documents.zip"',
        },
      }),
  )
  const zipped = await proxyConversionRequest(
    requestFor('extract-text', {}, { files: [pdf(), new File(['%PDF-1.7\n'], 'another.pdf')] }),
    archive.fetcher,
  )
  assert.equal(zipped.status, 200)
  assert.equal(zipped.headers.get('content-type'), 'application/zip')
  assert.deepEqual(new Uint8Array(await zipped.arrayBuffer()), zipBytes)
})

test('Gotenberg 9.1 attachment extraction supports multiple or binary embedded files', async () => {
  const archive = fixture(
    '9.1.0',
    () =>
      new Response(zipBytes, {
        headers: { 'Content-Type': 'application/zip' },
      }),
  )
  const zipped = await proxyConversionRequest(requestFor('extract-attachments'), archive.fetcher)
  assert.equal(zipped.status, 200)
  assert.deepEqual(new Uint8Array(await zipped.arrayBuffer()), zipBytes)

  const binary = fixture(
    '9.1.0',
    () =>
      new Response(new Uint8Array([0, 1, 2, 255]), {
        headers: {
          'Content-Type': 'application/vnd.example.custom',
          'Content-Disposition': 'attachment; filename="invoice_payload.dat"',
        },
      }),
  )
  const file = await proxyConversionRequest(requestFor('extract-attachments'), binary.fetcher)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'application/vnd.example.custom')
  assert.equal(downloadFilename(file.headers.get('content-disposition'), ''), 'invoice_payload.dat')
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([0, 1, 2, 255]))
})

test('extracted attachments can be empty or contain arbitrary bytes despite PDF MIME labels', async () => {
  const upstream = fixture(
    '9.1.0',
    () =>
      new Response('', {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="invoice_untrusted.pdf"',
          'Content-Length': '0',
        },
      }),
  )
  const empty = await proxyConversionRequest(requestFor('extract-attachments'), upstream.fetcher)
  assert.equal(empty.status, 200)
  assert.equal(await empty.text(), '')
  assert.equal(
    downloadFilename(empty.headers.get('content-disposition'), ''),
    'invoice_untrusted.pdf',
  )

  const invalidPdfBytes = fixture(
    '9.1.0',
    () =>
      new Response('arbitrary attachment data', {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="invoice_untrusted.pdf"',
        },
      }),
  )
  const nonPdf = await proxyConversionRequest(
    requestFor('extract-attachments'),
    invalidPdfBytes.fetcher,
  )
  assert.equal(nonPdf.status, 200)
  assert.equal(await nonPdf.text(), 'arbitrary attachment data')
})

test('untrusted arbitrary response types must carry an attachment filename', async () => {
  for (const contentDisposition of [null, 'inline; filename="fallback.html"', 'attachment']) {
    const upstream = fixture(
      '9.1.0',
      () =>
        new Response('<html>fallback</html>', {
          headers: {
            'Content-Type': 'text/html',
            ...(contentDisposition ? { 'Content-Disposition': contentDisposition } : {}),
          },
        }),
    )
    await assert.rejects(
      proxyConversionRequest(requestFor('extract-attachments'), upstream.fetcher),
      {
        status: 502,
        message: /unexpected conversion response/,
      },
    )
  }
})

test('pipeline extraction returns MIME types matching sole and multi-stage pipelines', async () => {
  const samples: [unknown[], string, string, BodyInit][] = [
    [[{ op: 'extract-text', pages: '1' }], 'text/plain', 'text/plain', 'hello'],
    [[{ op: 'extract-attachments' }], 'application/xml', 'application/xml', 'xml'],
    [[{ op: 'optimize' }, { op: 'extract-text' }], 'application/zip', 'application/zip', zipBytes],
    [
      [{ op: 'set-metadata', title: 'a' }, { op: 'extract-attachments' }],
      'application/zip',
      'application/zip',
      zipBytes,
    ],
  ]
  for (const [stages, expected, header, body] of samples) {
    const upstream = fixture('9.1.0', (path, form) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
      return new Response(body, {
        headers: {
          'Content-Type': header,
          ...(header === 'application/xml'
            ? { 'Content-Disposition': 'attachment; filename="invoice_note.xml"' }
            : {}),
        },
      })
    })
    const response = await proxyConversionRequest(
      requestFor('pdf-pipeline', {}, { stages: JSON.stringify(stages) }),
      upstream.fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), expected)
    await response.arrayBuffer()
  }
})

test('rejects a 9.0 worker selected by a 9.1 load-balanced version probe', async () => {
  for (const id of ['extract-text', 'extract-attachments']) {
    const upstream = fixture(
      '9.1.0',
      () =>
        new Response('unexpected result', {
          headers: { 'Content-Type': 'text/plain', 'Gotenberg-Version': '9.0.0' },
        }),
    )
    await assert.rejects(proxyConversionRequest(requestFor(id), upstream.fetcher), {
      status: 409,
      message: /cannot handle this 9\.1\+ operation/,
    })
  }
  const upstream = fixture(
    '9.1.0',
    () =>
      new Response(zipBytes, {
        headers: { 'Content-Type': 'application/zip', 'Gotenberg-Version': '9.0.0' },
      }),
  )
  await assert.rejects(
    proxyConversionRequest(
      requestFor(
        'pdf-pipeline',
        {},
        {
          stages: '[{"op":"optimize"},{"op":"extract-text"}]',
        },
      ),
      upstream.fetcher,
    ),
    { status: 409 },
  )
})

test('validates both extraction options and terminal-only rules', () => {
  assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"extract-text"}]')), [
    'text/plain',
    'application/zip',
  ])
  assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"extract-attachments"}]')), [
    '*',
    'application/zip',
  ])
  assert.deepEqual(
    pipelineResponseTypes(parsePdfPipeline('[{"op":"optimize"},{"op":"extract-text"}]')),
    ['application/zip'],
  )
  assert.throws(
    () => parsePdfPipeline('[{"op":"extract-text","annotations":"true"}]'),
    /true or false/,
  )
  assert.throws(() => parsePdfPipeline('[{"op":"extract-text","pages":"0"}]'), /page/i)
  assert.throws(
    () => parsePdfPipeline('[{"op":"extract-attachments"},{"op":"optimize"}]'),
    /last stage/,
  )
  assert.throws(() => parsePdfPipeline('[{"op":"extract-text"},{"op":"render"}]'), /last stage/)
  assert.throws(() => parsePdfPipeline('[{"op":"extract-text"}]', { gotenbergMinor: 0 }), {
    status: 409,
  })
  assert.equal(parsePdfPipeline('[{"op":"extract-text"}]', { gotenbergMinor: 1 }).length, 1)

  const attachment = OPERATION_BY_ID.get('extract-attachments')
  const text = OPERATION_BY_ID.get('extract-text')
  assert.ok(attachment)
  assert.ok(text)
  assert.equal(attachment.minGotenbergMinor, 1)
  assert.equal(text.minGotenbergMinor, 1)
  for (const operation of [attachment, text]) {
    const payload: ConversionPayload = { operation: operation.id, fields: {}, advanced: {} }
    const legacy = new FormData()
    legacy.append('files', pdf(), 'invoice.pdf')
    assert.equal(adaptPdfForm(operation, payload, legacy, 9, []).path, operation.path)
    assert.deepEqual(validatePayload(payload).operation, operation)
  }
})
