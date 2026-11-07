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
  it('lists all 28 distinct Gotenberg 9.1 stages, including explicit option templates', () => {
    assert.equal(PDF_PIPELINE_STAGES.length, 28)
    assert.equal(new Set(PDF_PIPELINE_STAGES.map(({ op }) => op)).size, 28)
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
  it('accepts PDF and ZIP output or final stage image output without allowing HTML', () => {
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"split","every":1}]')), [
      'application/pdf',
      'application/zip',
    ])
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline('[{"op":"render","format":"jpeg"}]')), [
      'image/jpeg',
      'application/zip',
    ])
    assert.deepEqual(pipelineResponseTypes(parsePdfPipeline(DEFAULT_PDF_PIPELINE)), [
      'application/pdf',
      'application/zip',
    ])
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
