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
      if (['encrypt', 'decrypt', 'timestamp'].includes(stage.op)) {
        // The template intentionally requires a password instead of supplying one.
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
    error([], /1 to 30/)
    error(
      Array.from({ length: 31 }, () => ({ op: 'optimize' })),
      /1 to 30/,
    )
    error([{}], /supported PDF operation/)
    error([{ op: 'hack' }], /supported PDF operation/)
    error([{ op: 'merge', unexpected: true }], /unknown option/)
    error([{ op: 'merge', password: 'secret' }], /unknown option/)
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
      /PDF\/A documents cannot be encrypted/,
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
        backendVersion: '9.1.0',
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
  it('hides Gotenberg 9.1-only extraction stages from a 9.0 pipeline editor', () => {
    const markup = renderToStaticMarkup(
      createElement(PdfPipelineBuilder, {
        backendVersion: '9.0.0',
        value: DEFAULT_PDF_PIPELINE,
        onChange: () => {},
        acknowledgedRedaction: false,
        onRedactionChange: () => {},
        error: null,
      }),
    )
    assert.doesNotMatch(markup, /value="extract-attachments"/)
    assert.doesNotMatch(markup, /value="extract-text"/)
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
