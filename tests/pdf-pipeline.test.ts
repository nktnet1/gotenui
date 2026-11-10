import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { PdfPipelineBuilder } from '#/components/pdf-pipeline-builder'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import {
  DEFAULT_PDF_PIPELINE,
  PDF_PIPELINE_STAGES,
  parsePdfPipeline,
  pipelineResponseTypes,
  safePipelinePreview,
} from '#/lib/pdf-pipeline'
import { adaptPdfPipeline } from '#/lib/pdf-pipeline-adapter'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { type ConversionPayload, validateFiles, validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'

const operation = OPERATION_BY_ID.get('pdf-pipeline')
if (!operation) throw new Error('Missing pipeline operation')

function input(stages: unknown, auxiliary: File[] = [], confirmed = false) {
  const payload: ConversionPayload = {
    operation: 'pdf-pipeline',
    fields: { stages: JSON.stringify(stages), acknowledgedRedaction: confirmed },
    advanced: {},
  }
  const legacy = new FormData()
  legacy.append('files', new File(['%PDF-1.7\n'], 'input.pdf'), 'input.pdf')
  return { payload, legacy, auxiliary }
}
function adapted(stages: unknown, auxiliary: File[] = [], confirmed = false) {
  const { payload, legacy } = input(stages, auxiliary, confirmed)
  return adaptPdfPipeline(payload, legacy, auxiliary)
}

const error = (stages: unknown, matches: RegExp) => {
  assert.throws(() => parsePdfPipeline(JSON.stringify(stages)), matches)
}

describe('PDF pipeline catalogue and stage contract', () => {
  it('lists all 29 distinct Gotenberg 9.2 stages, including explicit option templates', () => {
    assert.equal(PDF_PIPELINE_STAGES.length, 29)
    assert.equal(new Set(PDF_PIPELINE_STAGES.map(({ op }) => op)).size, 29)
    for (const stage of PDF_PIPELINE_STAGES) {
      assert.ok(stage.label)
      assert.ok(stage.description)
      if (['encrypt', 'timestamp'].includes(stage.op)) {
        // These templates intentionally require explicit credentials or an authority.
        assert.throws(
          () => parsePdfPipeline(JSON.stringify([{ op: stage.op, ...stage.options }])),
          /password|timestampUrl/,
        )
      } else {
        assert.equal(
          parsePdfPipeline(JSON.stringify([{ op: stage.op, ...stage.options }]), {
            acknowledgedRedaction: true,
          })[0]?.op,
          stage.op,
        )
      }
    }
  })
  it('preflights final extraction stages against the selected Gotenberg minor version', () => {
    const base = {
      localAssetNames: [],
      archivesPresent: false,
      remoteRows: [],
      remoteJson: '',
      acknowledgedRedaction: false,
    }
    for (const op of ['extract-text', 'extract-attachments']) {
      const stages = JSON.stringify([{ op }])
      assert.match(
        pdfPipelineEditorError(stages, { ...base, backendVersion: '9.0.0' }) ?? '',
        /9\.1 or newer/,
      )
      assert.equal(pdfPipelineEditorError(stages, { ...base, backendVersion: '9.1.0' }), null)
      assert.equal(pdfPipelineEditorError(stages, { ...base, backendVersion: '9.2.0' }), null)
      assert.equal(pdfPipelineEditorError(stages, base), null)
    }
    assert.equal(
      pdfPipelineEditorError('[{"op":"optimize"}]', { ...base, backendVersion: '9.0.0' }),
      null,
    )
  })

  it('includes the builder in the tool catalogue but gates it to v9', () => {
    assert.deepEqual(operation.supportedGotenbergMajors, [9])
    assert.equal(operation.path, '/forms/pdf/pipe')
    assert.deepEqual(
      validatePayload({
        operation: operation.id,
        fields: { stages: DEFAULT_PDF_PIPELINE },
        advanced: {},
      }).operation,
      operation,
    )
    const { payload, legacy } = input([{ op: 'merge' }])
    assert.throws(() => adaptPdfForm(operation, payload, legacy, 8, []), { status: 409 })
  })
  it('accepts large stamp text and metadata fields within the configured request budget', () => {
    const longText = 'Confidential report '.repeat(900)
    const stages = [
      { op: 'stamp-text', text: longText, x: 12, y: 12 },
      { op: 'set-metadata', title: longText },
    ]
    assert.ok(longText.length > 10_000)
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    const { payload, legacy } = input(stages)
    assert.doesNotThrow(() => validatePayload(payload))
    const output = adaptPdfPipeline(payload, legacy, [])
    assert.deepEqual(JSON.parse(String(output.form.get('stages'))), stages)
    // Keep type/shape validation even when string length is unrestricted.
    error([{ op: 'stamp-text', text: '', x: 12, y: 12 }], /non-empty/)
  })

  it('preserves a whitespace-only text stamp exactly as Gotenberg accepts it', () => {
    const stages = [{ op: 'stamp-text', text: '  \t  ', x: 12, y: 24 }]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    const { payload, legacy } = input(stages)
    assert.doesNotThrow(() => validatePayload(payload))
    assert.deepEqual(
      JSON.parse(String(adaptPdfPipeline(payload, legacy, []).form.get('stages'))),
      stages,
    )
  })

  it('accepts only Gotenberg standard PDF stamp fonts and six-digit RGB colours', () => {
    const fonts = [
      'Helvetica',
      'Helvetica-Bold',
      'Helvetica-Oblique',
      'Helvetica-BoldOblique',
      'Times-Roman',
      'Times-Bold',
      'Times-Italic',
      'Times-BoldItalic',
      'Courier',
      'Courier-Bold',
      'Courier-Oblique',
      'Courier-BoldOblique',
      'Symbol',
      'ZapfDingbats',
    ]
    for (const font of [...fonts, '']) {
      const stages = [{ op: 'stamp-text', text: 'DRAFT', font, color: '#aBc123' }]
      assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    }
    assert.deepEqual(
      parsePdfPipeline('[{"op":"stamp-text","text":"DRAFT","color":"","font":""}]'),
      [{ op: 'stamp-text', text: 'DRAFT', color: '', font: '' }],
    )
    const stages = [{ op: 'stamp-text', text: 'DRAFT', font: 'Helvetica', color: '#00ffAC' }]
    assert.deepEqual(JSON.parse(String(adapted(stages).form.get('stages'))), stages)
    for (const font of ['Garamond', 'times-roman', 'Helvetica Neue']) {
      error([{ op: 'stamp-text', text: 'DRAFT', font }], /14 standard PDF fonts/)
    }
    for (const color of ['red', '#abc', '#GG0000', '#0123456', '123456']) {
      error([{ op: 'stamp-text', text: 'DRAFT', color }], /#rrggbb hexadecimal/)
    }
  })

  it('accepts all six upstream Factur-X invoice levels but rejects unsupported ones', () => {
    for (const level of ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG']) {
      const stages = [{ op: 'remediate', profile: 'Factur-X', xml: 'invoice.xml', level }]
      assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    }
    const stages = [{ op: 'remediate', profile: 'Factur-X', xml: 'invoice.xml', level: 'EN 16931' }]
    assert.deepEqual(
      JSON.parse(String(adapted(stages, [new File(['xml'], 'invoice.xml')]).form.get('stages'))),
      stages,
    )
    error(
      [{ op: 'remediate', profile: 'Factur-X', xml: 'invoice.xml' }],
      /supported Factur-X level/,
    )
    error(
      [{ op: 'remediate', profile: 'Factur-X', xml: 'invoice.xml', level: 'UNKNOWN' }],
      /supported Factur-X level/,
    )
    assert.deepEqual(parsePdfPipeline('[{"op":"remediate","profile":"Factur-X"}]'), [
      { op: 'remediate', profile: 'Factur-X' },
    ])
  })

  it('allows x and y to be omitted independently from Gotenberg redaction rectangles', () => {
    const regions = [
      { page: 1, width: 100, height: 20 },
      { page: 2, x: -4, width: 50, height: 10 },
      { page: 3, y: 8, width: 50, height: 10 },
    ]
    const stages = [{ op: 'redact', regions }]
    assert.deepEqual(
      parsePdfPipeline(JSON.stringify(stages), { acknowledgedRedaction: true }),
      stages,
    )
    assert.deepEqual(JSON.parse(String(adapted(stages, [], true).form.get('stages'))), stages)
    assert.throws(() => adapted(stages), /Confirm that redaction/)
    for (const invalid of [
      { page: 1, height: 20 },
      { page: 1, width: 100 },
      { page: 1, width: 0, height: 20 },
      { page: 1, width: 100, height: -1 },
      { page: 1, width: 100, height: 20, x: null },
      { page: 1, width: 100, height: 20, y: '8' },
    ]) {
      assert.throws(
        () =>
          parsePdfPipeline(JSON.stringify([{ op: 'redact', regions: [invalid] }]), {
            acknowledgedRedaction: true,
          }),
        /invalid rectangle/,
      )
    }
  })

  it('accepts default insert position, negative redaction offsets, and extensionless signing assets', () => {
    const pipeline = [
      { op: 'insert', source: 'source.pdf' },
      { op: 'redact', regions: [{ page: 1, x: -12.5, y: -4, width: 40, height: 20 }] },
      { op: 'sign', certificate: 'cert.data', key: 'private.data' },
    ]
    assert.deepEqual(
      parsePdfPipeline(JSON.stringify(pipeline), { acknowledgedRedaction: true }),
      pipeline,
    )
    assert.deepEqual(
      JSON.parse(
        String(
          adapted(
            pipeline,
            [
              new File(['pdf'], 'source.pdf'),
              new File(['cert'], 'cert.data'),
              new File(['key'], 'private.data'),
            ],
            true,
          ).form.get('stages'),
        ),
      ),
      pipeline,
    )
    error([{ op: 'insert', source: 'source.pdf', at: -1 }], /valid integer/)
  })

  it('accepts explicit empty optional page selectors and attachment names, as upstream does', () => {
    const stages = [
      { op: 'insert', source: 'extra.pdf', sourcePages: '' },
      { op: 'rotate', angle: 90, pages: '' },
      { op: 'stamp-text', text: 'TEST', pages: '  ' },
      { op: 'extract-text', pages: '' },
    ]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    const { form } = adapted(stages, [new File(['%PDF-1.7'], 'extra.pdf')])
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
    assert.deepEqual(parsePdfPipeline('[{"op":"extract-attachments","name":""}]'), [
      { op: 'extract-attachments', name: '' },
    ])
    assert.deepEqual(parsePdfPipeline('[{"op":"extract-attachments","name":"  "}]'), [
      { op: 'extract-attachments', name: '  ' },
    ])
    error([{ op: 'select', pages: '' }], /non-empty/)
    error([{ op: 'delete', pages: '   ' }], /non-empty/)
    error([{ op: 'rotate', angle: 90, pages: 'all,1' }], /select pages/)
  })

  it('allows zero-byte attachment assets but not zero-byte source PDFs or other stage files', () => {
    const emptyAttachment = new File([], 'empty.txt')
    const stages = [{ op: 'attach', file: 'empty.txt' }]
    const { payload, legacy } = input(stages, [emptyAttachment])
    const source = new File(['%PDF-1.7\n'], 'input.pdf')
    assert.doesNotThrow(() =>
      validateFiles(operation, [source], [emptyAttachment], 4_000_000, payload),
    )
    const result = adaptPdfPipeline(payload, legacy, [emptyAttachment])
    assert.equal((result.form.getAll('files')[1] as File).size, 0)
    assert.throws(
      () =>
        validateFiles(
          operation,
          [new File([], 'input.pdf')],
          [emptyAttachment],
          4_000_000,
          payload,
        ),
      /input\.pdf is empty/,
    )
    assert.throws(
      () =>
        validateFiles(operation, [source], [new File([], 'unreferenced.txt')], 4_000_000, payload),
      /unreferenced\.txt is empty/,
    )
    const stamped = input([{ op: 'stamp-image', image: 'logo.png' }])
    assert.throws(
      () =>
        validateFiles(operation, [source], [new File([], 'logo.png')], 4_000_000, stamped.payload),
      /logo\.png is empty/,
    )
    const office = OPERATION_BY_ID.get('html-pdf')
    assert.ok(office)
    const conversion = {
      operation: office.id,
      fields: {},
      advanced: {},
      source: '<html><body>Invoice</body></html>',
      conversionStages: JSON.stringify(stages),
    }
    assert.doesNotThrow(() =>
      validateFiles(office, [], [], 4_000_000, conversion, {}, [emptyAttachment]),
    )
  })

  it('supports parameterised MIME types on attachment stages', () => {
    const pipeline = [
      { op: 'attach', file: 'invoice.xml', mimeType: 'application/xml; charset=UTF-8' },
    ]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(pipeline)), pipeline)
    assert.equal(adapted(pipeline, [new File(['<xml/>'], 'invoice.xml')]).path, '/forms/pdf/pipe')
    error([{ op: 'attach', file: 'invoice.xml', mimeType: 'text' }], /invalid MIME type/)
  })

  it('preserves order and named auxiliary inputs on the v9 form', () => {
    const auxiliary = [new File(['asset'], 'receipt.txt')]
    const stages = [
      { op: 'attach', file: 'receipt.txt' },
      { op: 'optimize' },
      { op: 'set-metadata', title: 'Done' },
    ]
    const { path, form } = adapted(stages, auxiliary)
    assert.equal(path, '/forms/pdf/pipe')
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
    assert.deepEqual(
      form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      ['input.pdf', 'receipt.txt'],
    )
    assert.equal(form.has('auxiliary'), false)
  })

  it('numbers only local input PDFs when a pipeline merges, preserving uploaded order and assets', async () => {
    const stages = [
      { op: 'set-metadata', title: 'Merge in upload order' },
      { op: 'merge' },
      { op: 'insert', source: '01_z-last.pdf', at: 0 },
    ]
    const { payload } = input(stages)
    const legacy = new FormData()
    const sources = [
      new File(['first'], 'z-last.pdf'),
      new File(['second'], '2-first.pdf'),
      new File(['third'], '2-first.pdf'),
    ]
    for (const file of sources) legacy.append('files', file, file.name)
    const asset = new File(['attachment'], '01_z-last.pdf')
    const { form } = adaptPdfPipeline(payload, legacy, [asset])
    assert.deepEqual(
      (form.getAll('files') as File[]).map(({ name }) => name),
      ['01__z-last.pdf', '02_2-first.pdf', '03_2-first.pdf', '01_z-last.pdf'],
    )
    assert.deepEqual(
      await Promise.all((form.getAll('files') as File[]).map((file) => file.text())),
      ['first', 'second', 'third', 'attachment'],
    )
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)

    const noMerge = input([{ op: 'optimize' }]).payload
    const unmerged = adaptPdfPipeline(noMerge, legacy, [])
    assert.deepEqual(
      (unmerged.form.getAll('files') as File[]).map(({ name }) => name),
      ['z-last.pdf', '2-first.pdf', '2-first.pdf'],
    )
  })
  it('normalises Unicode asset references without altering embedded attachment names', () => {
    const original = 'cafe\u0301.txt'
    const canonical = original.normalize('NFC')
    const displayed = 'Re\u0301sume\u0301.txt'
    const stages = [{ op: 'attach', file: original, name: displayed }]
    const expected = [{ op: 'attach', file: canonical, name: displayed }]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages), { assetNames: [original] }), expected)
    const attachment = new File(['evidence'], original)
    const { payload, legacy } = input(stages, [attachment])
    assert.doesNotThrow(() =>
      validateFiles(
        operation,
        [new File(['%PDF-1.7'], 'input.pdf')],
        [attachment],
        4_000_000,
        payload,
      ),
    )
    const { form } = adaptPdfPipeline(payload, legacy, [attachment])
    assert.deepEqual(JSON.parse(String(form.get('stages'))), expected)
    assert.equal((form.getAll('files')[1] as File).name, original)
  })

  it('matches decomposed Unicode remote asset hints to canonical pipeline references', () => {
    const decomposed = 'cafe\u0301.png'
    const canonical = decomposed.normalize('NFC')
    const stages = [{ op: 'stamp-image', image: decomposed, x: 10, y: 20 }]
    const { payload, legacy } = input(stages)
    payload.downloadFrom = [{ url: 'https://example.test/assets/stamp', name: decomposed }]
    legacy.set('downloadFrom', JSON.stringify([{ url: payload.downloadFrom[0]?.url }]))
    assert.doesNotThrow(() =>
      validateFiles(operation, [new File(['%PDF-1.7'], 'input.pdf')], [], 4_000_000, payload),
    )
    assert.deepEqual(JSON.parse(String(adaptPdfPipeline(payload, legacy, []).form.get('stages'))), [
      { op: 'stamp-image', image: canonical, x: 10, y: 20 },
    ])
  })

  it('supports upstream empty defaults without inventing missing PDF stage assets', () => {
    const stages = [
      { op: 'remediate', profile: 'Factur-X', xml: '' },
      { op: 'sign', certificate: 'signing.p12', key: '' },
    ]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    const signingFile = new File(['certificate'], 'signing.p12')
    const { form } = adapted(stages, [signingFile])
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
    assert.deepEqual(
      form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      ['input.pdf', 'signing.p12'],
    )
    // With no assets, an explicitly empty XML reference is not a missing file.
    assert.deepEqual(JSON.parse(String(adapted([stages[0]]).form.get('stages'))), [stages[0]])
    assert.throws(
      () =>
        adapted([{ op: 'sign', certificate: 'signing.p12', key: 'missing.pem' }], [signingFile]),
      /upload an additional file/,
    )
  })

  it('allows empty defaults and range combinations accepted by the upstream stage parser', () => {
    for (const stages of [
      [{ op: 'split', every: 2, ranges: [] }],
      [{ op: 'split', every: 2, ranges: null }],
      [{ op: 'encrypt', userPassword: 'secret', algorithm: '' }],
      [{ op: 'render', format: '' }],
    ]) {
      assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
      assert.deepEqual(JSON.parse(String(adapted(stages).form.get('stages'))), stages)
    }
    assert.deepEqual(pipelineResponseTypes([{ op: 'render', format: '' }]), [
      'image/png',
      'application/zip',
    ])
    error([{ op: 'split', ranges: [] }], /either every or ranges/)
    error([{ op: 'split', every: 2, ranges: ['1-2'] }], /either every or ranges/)
    error([{ op: 'stamp-text' }], /text must be non-empty/)
  })

  it('preserves whitespace-only embedded names and stage file references', () => {
    const attachment = new File(['data'], '   ')
    const stages = [
      { op: 'attach', file: '   ', name: '  ' },
      { op: 'detach', name: '  ' },
    ]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    const { payload, legacy } = input(stages, [attachment])
    assert.doesNotThrow(() =>
      validateFiles(
        operation,
        [new File(['%PDF-1.7'], 'input.pdf')],
        [attachment],
        4_000_000,
        payload,
      ),
    )
    assert.deepEqual(
      JSON.parse(String(adaptPdfPipeline(payload, legacy, [attachment]).form.get('stages'))),
      stages,
    )
    error([{ op: 'attach', file: '' }], /non-empty/)
    error([{ op: 'select', pages: '  ' }], /non-empty/)
  })

  it('accepts remote input PDFs and PDF ZIPs without treating remote files as stage assets', () => {
    const { payload, legacy } = input([{ op: 'optimize' }])
    payload.downloadFrom = [
      {
        url: 'https://files.example.test/private.pdf',
        extraHttpHeaders: { Authorization: 'Bearer secret' },
      },
    ]
    legacy.set('downloadFrom', JSON.stringify(payload.downloadFrom))
    const archives = [new File(['PK\u0003\u0004'], 'documents.zip')]
    const { path, form } = adaptPdfPipeline(payload, legacy, [], archives)
    assert.equal(path, '/forms/pdf/pipe')
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), payload.downloadFrom)
    assert.equal((form.get('archives') as File).name, 'documents.zip')
    assert.deepEqual(
      form.getAll('files').map((file) => (file as File).name),
      ['input.pdf'],
    )
    assert.equal(form.has('auxiliary'), false)
  })
  it('accepts named remote stage assets without treating them as input documents', () => {
    const { payload, legacy } = input([
      { op: 'stamp-image', image: 'stamp.png', x: 10, y: 10 },
      { op: 'attach', file: 'invoice.xml' },
    ])
    payload.downloadFrom = [
      { url: 'https://example.test/signed/stamp', name: 'stamp.png' },
      { url: 'https://example.test/invoices/837', name: 'invoice.xml' },
    ]
    legacy.set(
      'downloadFrom',
      JSON.stringify(payload.downloadFrom.map(({ name, ...remote }) => remote)),
    )
    const result = adaptPdfPipeline(payload, legacy, [])
    assert.deepEqual(JSON.parse(String(result.form.get('stages'))), [
      { op: 'stamp-image', image: 'stamp.png', x: 10, y: 10 },
      { op: 'attach', file: 'invoice.xml' },
    ])
    assert.equal(result.form.getAll('files').length, 1)
    assert.deepEqual(JSON.parse(String(result.form.get('downloadFrom'))), [
      { url: 'https://example.test/signed/stamp' },
      { url: 'https://example.test/invoices/837' },
    ])
    assert.throws(
      () => adaptPdfPipeline(payload, legacy, [new File(['asset'], 'invoice.xml')]),
      /duplicates another file/,
    )
    assert.throws(
      () =>
        adaptPdfPipeline(
          {
            ...payload,
            downloadFrom: [
              ...(payload.downloadFrom ?? []),
              { url: 'https://example.test/again', name: 'stamp.png' },
            ],
          },
          legacy,
          [],
        ),
      /duplicates another file/,
    )
  })
  it('does not count remote stage assets as PDF source documents', () => {
    const remoteAsset = {
      url: 'https://example.test/attachment.pdf',
      name: 'attachment.pdf',
    }
    const stages = '[{"op":"attach","file":"attachment.pdf"}]'
    const payload: ConversionPayload = {
      operation: 'pdf-pipeline',
      fields: { stages },
      advanced: {},
      downloadFrom: [remoteAsset],
    }
    assert.throws(
      () => validateFiles(operation, [], [], 1_000_000, payload),
      /Upload at least 1 input file/,
    )
    const source = { url: 'https://example.test/source.pdf' }
    assert.doesNotThrow(() =>
      validateFiles(operation, [], [], 1_000_000, {
        ...payload,
        downloadFrom: [remoteAsset, source],
      }),
    )
  })
  it('requires named stage uploads and rejects legacy remote destinations and settings', () => {
    assert.throws(
      () => adapted([{ op: 'attach', file: 'missing.txt' }]),
      /upload an additional file/,
    )
    const bad = input([{ op: 'optimize' }])
    for (const destination of [{ field: 'embedded' as const }, { embedded: true }]) {
      bad.payload.downloadFrom = [{ url: 'https://example.com/input.pdf', ...destination }]
      assert.throws(() => adaptPdfPipeline(bad.payload, bad.legacy, []), /not legacy remote/)
    }
    bad.payload.downloadFrom = undefined
    bad.payload.advanced = { optimizeImages: true }
    assert.throws(() => adaptPdfPipeline(bad.payload, bad.legacy, []), /legacy advanced/)
  })
  it('requires explicit redaction acknowledgement and never puts it in upstream stages', () => {
    const stages = [{ op: 'redact', regions: [{ page: 1, x: 0, y: 0, width: 10, height: 10 }] }]
    assert.throws(() => adapted(stages), /Confirm that redaction/)
    assert.deepEqual(JSON.parse(String(adapted(stages, [], true).form.get('stages'))), stages)
  })
  it('ensures input and auxiliary files respect shared upload validation', () => {
    const file = new File(['%PDF-1.7'], 'input.pdf')
    assert.throws(
      () => validateFiles(operation, [file], [file], 1_000_000, input([]).payload),
      /Duplicate filename/,
    )
  })
  it('matches Gotenberg output types for PDF edits followed by rendering', () => {
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"split","every":1}]')), [
      'application/pdf',
      'application/zip',
    ])
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"render","format":"jpeg"}]')), [
      'image/jpeg',
      'application/zip',
    ])
    assert.deepEqual(
      pipelineResponseTypes(
        parsePdfPipeline('[{"op":"rotate","angle":90},{"op":"render","format":"png"}]'),
      ),
      ['application/zip'],
    )
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline(DEFAULT_PDF_PIPELINE)), [
      'application/pdf',
      'application/zip',
    ])
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"merge"}]')), [
      'application/pdf',
    ])
    assert.deepEqual(
      pipelineResponseTypes(
        parsePdfPipeline('[{"op":"split","every":1},{"op":"merge"},{"op":"optimize"}]'),
      ),
      ['application/pdf'],
    )
    assert.deepEqual(
      pipelineResponseTypes(parsePdfPipeline('[{"op":"merge"},{"op":"split","every":1}]')),
      ['application/pdf', 'application/zip'],
    )
    assert.deepEqual(
      pipelineResponseTypes(parsePdfPipeline('[{"op":"merge"},{"op":"render","format":"png"}]')),
      ['application/zip'],
    )
  })
  it('redacts secrets in previews', () => {
    const preview = safePipelinePreview([
      { op: 'encrypt', userPassword: 'very-secret', ownerPassword: 'another-secret' },
    ])
    assert.doesNotMatch(preview, /very-secret|another-secret/)
    assert.match(preview, /••••••/)
  })
})

describe('PDF pipeline rejects unsafe or invalid sequences', () => {
  it('checks JSON shape, length and unknown operations', () => {
    assert.throws(() => parsePdfPipeline('{'), /valid JSON/)
    error([], /at least one/)
    assert.equal(
      parsePdfPipeline(JSON.stringify(Array.from({ length: 31 }, () => ({ op: 'optimize' }))))
        .length,
      31,
    )
    error([{}], /supported PDF operation/)
    error([{ op: 'hack' }], /supported PDF operation/)
    error([{ op: 'merge', unexpected: true }], /unknown option/)
    error([{ op: 'merge', password: 'secret' }], /unknown option/)
  })
  it('accepts upstream page selectors and owner-password-only decryption', () => {
    const stages = [
      { op: 'decrypt' },
      { op: 'split', ranges: ['all', 'last', 'odd,2'] },
      { op: 'insert', source: 'additional.pdf', at: 0, sourcePages: 'last' },
      { op: 'rotate', angle: 90, pages: 'all' },
      { op: 'select', pages: 'last,1' },
    ]
    assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
    assert.deepEqual(parsePdfPipeline('[{"op":"decrypt","password":""}]'), [
      { op: 'decrypt', password: '' },
    ])
    error([{ op: 'decrypt', password: 123 }], /password.*string/)
    error([{ op: 'select', pages: 'all,1' }], /select pages/)
    error([{ op: 'split', ranges: ['all,last'] }], /page selectors/)
    error([{ op: 'delete', pages: '1;echo unsafe' }], /select pages/)
  })
  it('allows large form and redaction arrays, but still rejects invalid values', () => {
    const fields: Record<string, string | string[]> = Object.fromEntries(
      Array.from({ length: 120 }, (_, index) => [`Input.${index}`, 'Yes']),
    )
    fields[`VeryLong.${'name'.repeat(60)}`] = Array.from({ length: 60 }, (_, i) => `item${i}`)
    const regions = Array.from({ length: 150 }, (_, index) => ({
      page: 1,
      x: index,
      y: 0,
      width: 1,
      height: 1,
    }))
    assert.deepEqual(parsePdfPipeline(JSON.stringify([{ op: 'set-form', fields }])), [
      { op: 'set-form', fields },
    ])
    assert.deepEqual(
      parsePdfPipeline(JSON.stringify([{ op: 'redact', regions }]), {
        acknowledgedRedaction: true,
      }),
      [{ op: 'redact', regions }],
    )
    assert.deepEqual(parsePdfPipeline('[{"op":"set-form","fields":{" ":"Yes"}}]'), [
      { op: 'set-form', fields: { ' ': 'Yes' } },
    ])
    error([{ op: 'set-form', fields: { bad: [5] } }], /fields must map/)
    error([{ op: 'redact', regions: [] }], /at least one rectangle/)
  })
  it('enforces positions and duplicate singleton stages', () => {
    error([{ op: 'merge' }, { op: 'decrypt', password: 'secret' }], /first stage/)
    error([{ op: 'render' }, { op: 'rotate', angle: 90 }], /last stage/)
    error(
      [
        { op: 'remediate', profile: 'PDF/A-2b' },
        { op: 'remediate', profile: 'PDF/A-2b' },
      ],
      /Only one remediate/,
    )
    error(
      [
        { op: 'encrypt', userPassword: 'a' },
        { op: 'rotate', angle: 90 },
      ],
      /cannot follow encryption/,
    )
    error(
      [{ op: 'sign', certificate: 'test.p12' }, { op: 'optimize' }],
      /cannot follow digital signing/,
    )
    error(
      [
        { op: 'remediate', profile: 'PDF/A-2b' },
        { op: 'rotate', angle: 90 },
      ],
      /cannot follow remediation/,
    )
  })
  it('rejects incompatible remediation, encryption and signing combinations', () => {
    error(
      [
        { op: 'decrypt', password: 'pass' },
        { op: 'sign', certificate: 'test.p12' },
      ],
      /separate requests/,
    )
    error(
      [
        { op: 'sign', certificate: 'test.p12' },
        { op: 'encrypt', userPassword: 'pass' },
      ],
      /cannot follow digital signing|cannot be combined/,
    )
    error(
      [
        { op: 'remediate', profile: 'PDF/A-2b' },
        { op: 'encrypt', userPassword: 'pass' },
      ],
      /PDF\/A and Factur-X documents cannot be encrypted/,
    )
    error(
      [
        { op: 'remediate', profile: 'Factur-X' },
        { op: 'encrypt', userPassword: 'pass' },
      ],
      /Factur-X documents cannot be encrypted/,
    )
    error([{ op: 'remediate', profile: ['PDF/A-4', 'PDF/UA-1'] }], /incompatible/)
  })
  it('checks page selectors, required options and nested JSON', () => {
    error([{ op: 'select', pages: '1;2' }], /select pages/)
    error([{ op: 'split' }], /either every or ranges/)
    error([{ op: 'split', every: 2, ranges: ['1-2'] }], /either every or ranges/)
    error([{ op: 'insert', source: 'source.pdf', at: -1 }], /valid integer/)
    error([{ op: 'rotate', angle: 25 }], /multiple of 90/)
    error([{ op: 'set-form', fields: {} }], /fields must map/)
    error([{ op: 'set-bookmarks', bookmarks: [{ title: '' }] }], /title and positive pageNumber/)
    error(
      [{ op: 'redact', regions: [{ page: 1, x: 0, y: 0, width: -5, height: 9 }] }],
      /invalid rectangle/,
    )
    error([{ op: 'render', format: 'png', quality: 50 }], /JPEG quality/)
    error([{ op: 'timestamp', timestampUrl: 'file:///etc/passwd' }], /HTTP\(S\)/)
  })
})

describe('visual pipeline builder', () => {
  it('renders all 28 stage choices and accessible stage movement controls', () => {
    const markup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, {
        value: DEFAULT_PDF_PIPELINE,
        onChange: () => {},
        acknowledgedRedaction: false,
        onRedactionChange: () => {},
        error: null,
      }),
    )
    for (const stage of PDF_PIPELINE_STAGES) {
      assert.ok(markup.includes(`value="${stage.op}"`), `Missing stage option: ${stage.op}`)
    }
    assert.match(markup, /data-testid="pdf-pipeline-builder"/)
    assert.match(markup, /aria-label="Ordered PDF processing stages"/)
    assert.match(markup, /aria-label="Move Optimise up"/)
    assert.match(markup, /aria-label="Move Optimise down"/)
    assert.match(markup, /aria-label="Remove Optimise"/)
    assert.match(markup, /Preview ordered stages/)
  })
  it('offers both extraction stages without relying on a backend minor version', () => {
    const markup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, {
        value: DEFAULT_PDF_PIPELINE,
        onChange: () => {},
        acknowledgedRedaction: false,
        onRedactionChange: () => {},
        error: null,
      }),
    )
    assert.match(markup, /value="extract-attachments"/)
    assert.match(markup, /value="extract-text"/)
    assert.match(markup, /value="render"/)
  })

  it('hides decryption in conversion-time pipelines and labels their file uploader', () => {
    const markup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, {
        value: DEFAULT_PDF_PIPELINE,
        onChange: () => {},
        acknowledgedRedaction: false,
        onRedactionChange: () => {},
        error: null,
        conversionMode: true,
      }),
    )
    assert.doesNotMatch(markup, /value="decrypt"/)
    assert.match(markup, /value="sign"/)
    assert.match(markup, /Pipeline stage files/)
  })
  it('shows a mandatory redaction confirmation only for redaction stages', () => {
    const props = {
      onChange: () => {},
      acknowledgedRedaction: false,
      onRedactionChange: () => {},
      error: null,
    }
    const defaultMarkup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, { ...props, value: DEFAULT_PDF_PIPELINE }),
    )
    assert.doesNotMatch(defaultMarkup, /redaction permanently removes content/)
    const redactionMarkup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, {
        ...props,
        value: JSON.stringify([
          { op: 'redact', regions: [{ page: 1, x: 0, y: 0, width: 10, height: 10 }] },
        ]),
      }),
    )
    assert.match(redactionMarkup, /redaction permanently removes content/)
    assert.match(redactionMarkup, /type="checkbox"/)
  })
})
