import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { adaptPdfPipeline } from '#/lib/pdf-pipeline-adapter'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { type ConversionPayload, validateFiles } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'
import { zipFixture } from './fixtures/zip'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'
const pdf = (name = 'input.pdf') => new File(['%PDF-1.7\n'], name, { type: 'application/pdf' })

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

function request(
  operation: string,
  fields: Record<string, string | boolean> = {},
  files: File[] = [pdf()],
  options: {
    auxiliary?: File[]
    stageFiles?: File[]
    archives?: File[]
    conversionStages?: string
    downloadFrom?: { url: string; name?: string }[]
  } = {},
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields,
      advanced: {},
      ...(options.conversionStages ? { conversionStages: options.conversionStages } : {}),
      ...(options.downloadFrom ? { downloadFrom: options.downloadFrom } : {}),
    }),
  )
  for (const file of files) body.append('files', file, file.name)
  for (const file of options.auxiliary ?? []) body.append('auxiliary', file, file.name)
  for (const file of options.stageFiles ?? []) body.append('stageFile', file, file.name)
  for (const file of options.archives ?? []) body.append('archives', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function fixture(version: string, onConvert: (path: string, form: FormData) => void) {
  let forwarded = 0
  const fetcher: typeof fetch = async (url, options) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    forwarded++
    assert.ok(options?.body instanceof FormData)
    onConvert(new URL(String(url)).pathname, options.body)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  return { fetcher, forwarded: () => forwarded }
}

test.each([
  ['insert', { source: 'pages.data', at: 0 }],
  ['stamp-pdf', { source: 'overlay.content', sourcePage: 1 }],
  ['remediate', { profile: 'Factur-X', xml: 'invoice.payload', level: 'EN 16931' }],
] as const)('accepts named %s asset without a misleading filename-extension rule', (op, values) => {
  const stages = parsePdfPipeline(JSON.stringify([{ op, ...values }]))
  assert.deepEqual(stages, [{ op, ...values }])
  const legacy = new FormData()
  legacy.append('files', pdf())
  const asset =
    op === 'insert' ? 'pages.data' : op === 'stamp-pdf' ? 'overlay.content' : 'invoice.payload'
  const payload: ConversionPayload = {
    operation: 'pdf-pipeline',
    fields: { stages: JSON.stringify(stages) },
    advanced: {},
  }
  const forwarded = adaptPdfPipeline(payload, legacy, [new File(['source bytes'], asset)])
  assert.equal(forwarded.path, '/forms/pdf/pipe')
  assert.equal((forwarded.form.getAll('files')[1] as File).name, asset)
  assert.deepEqual(JSON.parse(String(forwarded.form.get('stages'))), stages)
})

test('standalone page insertion and PDF overlays support named PDF assets without .pdf', () => {
  for (const [id, sourceFields] of [
    ['insert-pages', {}],
    [
      'stamp',
      {
        v9OverlayAcknowledged: true,
        stampSource: 'pdf',
        stampExpression: 'overlay.content',
      },
    ],
    [
      'watermark',
      {
        v9OverlayAcknowledged: true,
        watermarkSource: 'pdf',
        watermarkExpression: 'overlay.content',
      },
    ],
  ] as const) {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    const name = 'overlay.content'
    const auxiliary = [new File(['%PDF-1.7\n'], name)]
    const payload: ConversionPayload = { operation: id, fields: sourceFields, advanced: {} }
    validateFiles(operation, [pdf()], auxiliary, 4_000_000, payload, {}, [], [], 9)
    const legacy = createGotenbergForm(operation, payload, [pdf()], auxiliary, 4_000_000, {}, [], 9)
    const adapted = adaptPdfForm(operation, payload, legacy, 9, auxiliary)
    const stages = JSON.parse(String(adapted.form.get('stages')))
    assert.equal(stages[0]?.op, id === 'insert-pages' ? 'insert' : 'stamp-pdf')
    assert.equal(stages[0]?.source, name)
  }
})

test('ordinary source PDFs still need .pdf; image stamps still need a PNG/JPEG suffix', () => {
  const pipeline = OPERATION_BY_ID.get('pdf-pipeline')
  assert.ok(pipeline)
  const payload = {
    operation: 'pdf-pipeline',
    fields: { stages: '[{"op":"optimize"}]' },
    advanced: {},
  }
  assert.throws(
    () => validateFiles(pipeline, [pdf('source.data')], [], 4_000_000, payload, {}, [], [], 9),
    /only accept \.pdf input documents/,
  )
  assert.throws(
    () => parsePdfPipeline('[{"op":"stamp-image","image":"image.data"}]'),
    /PNG or JPEG/,
  )
})

test('v9 Factur-X accepts renamed XML payloads; v8 keeps its XML-name contract', async () => {
  const invoice = new File(['<Invoice />'], 'invoice.payload', { type: 'application/xml' })
  const fields = { facturxConformanceLevel: 'EN 16931' }
  const v9 = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/pipe')
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [
      { op: 'remediate', profile: 'Factur-X', xml: 'invoice.payload', level: 'EN 16931' },
    ])
    assert.deepEqual(
      (form.getAll('files') as File[]).map((file) => file.name),
      ['input.pdf', 'invoice.payload'],
    )
  })
  assert.equal(
    (
      await proxyConversionRequest(
        request('factur-x', fields, [pdf()], { auxiliary: [invoice] }),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.equal(v9.forwarded(), 1)
  const v8 = fixture('8.40.0', () => assert.fail('v8 must reject the renamed XML asset'))
  await assert.rejects(
    proxyConversionRequest(
      request('factur-x', fields, [pdf()], { auxiliary: [invoice] }),
      v8.fetcher,
    ),
    /Factur-X needs an XML invoice/,
  )
  assert.equal(v8.forwarded(), 0)
})

test('v9 PDF pipeline and Office conversion accept extensionless Factur-X XML assets', async () => {
  const stages = JSON.stringify([
    { op: 'remediate', profile: 'Factur-X', xml: 'invoice.payload', level: 'EN 16931' },
  ])
  for (const operation of ['pdf-pipeline', 'office-pdf'] as const) {
    const v9 = fixture('9.1.0', (path, form) => {
      assert.equal(
        path,
        operation === 'office-pdf' ? '/forms/libreoffice/convert' : '/forms/pdf/pipe',
      )
      assert.deepEqual(JSON.parse(String(form.get('stages'))), JSON.parse(stages))
      assert.ok((form.getAll('files') as File[]).some((file) => file.name === 'invoice.payload'))
    })
    const fields: Record<string, string | boolean> = operation === 'pdf-pipeline' ? { stages } : {}
    assert.equal(
      (
        await proxyConversionRequest(
          request(
            operation,
            fields,
            [operation === 'office-pdf' ? new File(['office'], 'document.docx') : pdf()],
            {
              ...(operation === 'office-pdf'
                ? {
                    conversionStages: stages,
                    stageFiles: [new File(['<Invoice/>'], 'invoice.payload')],
                  }
                : { auxiliary: [new File(['<Invoice/>'], 'invoice.payload')] }),
            },
          ),
          v9.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(v9.forwarded(), 1)
  }
})

test('v9 merge accepts one local or remote PDF; v8 keeps two-PDF guard', async () => {
  const fields = { stages: '[{"op":"merge"}]' }
  const v9 = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/pipe')
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'merge' }])
  })
  assert.equal(
    (await proxyConversionRequest(request('pdf-pipeline', fields), v9.fetcher)).status,
    200,
  )
  assert.equal(
    (
      await proxyConversionRequest(
        request('merge', {}, [], { downloadFrom: [{ url: 'https://example.test/one.pdf' }] }),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.equal(v9.forwarded(), 2)
  const v8 = fixture('8.40.0', () => assert.fail('Gotenberg 8 requires more input documents'))
  await assert.rejects(proxyConversionRequest(request('merge'), v8.fetcher), /Upload at least 2/)
  assert.equal(v8.forwarded(), 0)
})

test('v9 ZIP archives use their contents, not a .zip filename extension', async () => {
  const archive = new File([zipFixture({ 'one.pdf': '%PDF-1.7\n' })], 'renamed.payload')
  const v9 = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/pipe')
    assert.equal((form.get('archives') as File).name, 'renamed.payload')
  })
  assert.equal(
    (
      await proxyConversionRequest(
        request('pdf-pipeline', { stages: '[{"op":"merge"}]' }, [], { archives: [archive] }),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.equal(v9.forwarded(), 1)
  const invalid = new File(['not a ZIP'], 'looks-like.zip')
  await assert.rejects(
    proxyConversionRequest(
      request('pdf-pipeline', { stages: '[{"op":"merge"}]' }, [], { archives: [invalid] }),
      v9.fetcher,
    ),
    /ZIP central directory is missing/,
  )
  assert.equal(v9.forwarded(), 1)
  const v8 = fixture('8.40.0', () => assert.fail('v8 must reject archive inputs'))
  await assert.rejects(
    proxyConversionRequest(request('merge', {}, [], { archives: [archive] }), v8.fetcher),
    /require Gotenberg 9/,
  )
  assert.equal(v8.forwarded(), 0)
})

test('v9 standalone stamp forwards a renamed PDF asset rather than blocking it', async () => {
  const v9 = fixture('9.1.0', (path, form) => {
    assert.equal(path, '/forms/pdf/pipe')
    assert.equal((form.getAll('files')[1] as File).name, 'overlay.payload')
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [
      { op: 'stamp-pdf', source: 'overlay.payload', x: 48, y: 48 },
    ])
  })
  assert.equal(
    (
      await proxyConversionRequest(
        request(
          'stamp',
          { v9OverlayAcknowledged: true, stampSource: 'pdf', stampExpression: 'overlay.payload' },
          [pdf()],
          {
            auxiliary: [pdf('overlay.payload')],
          },
        ),
        v9.fetcher,
      )
    ).status,
    200,
  )
  assert.equal(v9.forwarded(), 1)
})

test('unnamed remote downloads may supply named PDF stage assets resolved by Gotenberg', async () => {
  const stages = JSON.stringify([{ op: 'insert', source: 'remote-asset.data', at: 0 }])
  assert.equal(
    pdfPipelineEditorError(stages, {
      localAssetNames: [],
      archivesPresent: false,
      remoteRows: [{ id: 1, url: 'https://files.example.test/asset', field: '', headers: [] }],
      remoteJson: '',
      acknowledgedRedaction: false,
      backendVersion: '9.1.0',
    }),
    null,
  )
  for (const operation of ['pdf-pipeline', 'office-pdf'] as const) {
    const v9 = fixture('9.1.0', (_path, form) => {
      assert.deepEqual(JSON.parse(String(form.get('stages'))), JSON.parse(stages))
      assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
        { url: 'https://files.example.test/asset' },
      ])
    })
    const payloadFields: Record<string, string | boolean> =
      operation === 'pdf-pipeline' ? { stages } : {}
    const file = operation === 'pdf-pipeline' ? pdf() : new File(['office'], 'source.docx')
    assert.equal(
      (
        await proxyConversionRequest(
          request(operation, payloadFields, [file], {
            ...(operation === 'office-pdf' ? { conversionStages: stages } : {}),
            downloadFrom: [{ url: 'https://files.example.test/asset' }],
          }),
          v9.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(v9.forwarded(), 1)
  }
  assert.match(
    pdfPipelineEditorError(stages, {
      localAssetNames: [],
      archivesPresent: false,
      remoteRows: [],
      remoteJson: '',
      acknowledgedRedaction: false,
    }) ?? '',
    /remote-asset.data/,
  )
})

test('v9 ZIP stage assets are resolved by their names rather than XML or PDF extensions', async () => {
  for (const [stage, asset] of [
    [{ op: 'stamp-pdf', source: 'overlay.payload' }, 'overlay.payload'],
    [{ op: 'insert', source: 'pages.data' }, 'pages.data'],
    [
      { op: 'remediate', profile: 'Factur-X', xml: 'invoice.payload', level: 'EN 16931' },
      'invoice.payload',
    ],
  ] as const) {
    const archive = new File([zipFixture({ [asset]: 'the stage asset contents' })], 'assets.data')
    const v9 = fixture('9.1.0', (path, form) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.equal((form.get('archives') as File).name, 'assets.data')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [stage])
    })
    assert.equal(
      (
        await proxyConversionRequest(
          request('pdf-pipeline', { stages: JSON.stringify([stage]) }, [pdf()], {
            archives: [archive],
          }),
          v9.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(v9.forwarded(), 1)
  }
})
