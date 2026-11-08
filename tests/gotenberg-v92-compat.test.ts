import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { RemoteInputsEditor } from '#/components/async-inputs-editor'
import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { unavailableOperationReason } from '#/lib/operation-availability'
import {
  hasGotenberg92PageSyntax,
  isPdfPageSelector,
  stagesUseGotenberg92PageSyntax,
} from '#/lib/pdf-page-selectors'
import { parsePdfPipeline, pdfStageAssetNames, pipelineResponseTypes } from '#/lib/pdf-pipeline'
import { adaptPdfPipeline } from '#/lib/pdf-pipeline-adapter'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { type ConversionPayload, validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID, operationDefaults } from '#/tools/registry'

const origin = 'https://gotenui.example.test'
const backend = 'http://127.0.0.1:3000'
const pdf = (name = 'source.pdf') => new File(['%PDF-1.7\n'], name, { type: 'application/pdf' })
const getOperation = (name: string) => {
  const operation = OPERATION_BY_ID.get(name)
  assert.ok(operation, name)
  return operation
}
const legacyFiles = (...files: File[]) => {
  const legacy = new FormData()
  for (const file of files) legacy.append('files', file, file.name)
  return legacy
}

const editorOptions = {
  localAssetNames: [] as string[],
  archivesPresent: false,
  remoteRows: [] as RemoteInputRow[],
  remoteJson: '',
  acknowledgedRedaction: false,
}

function composeForm(fields: Record<string, string> = {}) {
  const operation = getOperation('compose-pages')
  const payload: ConversionPayload = {
    operation: operation.id,
    fields: { ...operationDefaults(operation), ...fields },
    advanced: {},
  }
  const parsed = validatePayload(payload)
  return adaptPdfForm(parsed.operation, parsed.payload, legacyFiles(pdf()), 9, [])
}

function request(
  operation: string,
  fields: Record<string, string | boolean>,
  extra: Record<string, unknown> = {},
) {
  const body = new FormData()
  body.set('payload', JSON.stringify({ operation, fields, advanced: {}, ...extra }))
  body.append('files', pdf(), 'source.pdf')
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend },
    body,
  })
}

function server(version: string, onConvert: (pathname: string, form: FormData) => void) {
  let conversions = 0
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input) === `${backend}/version`) return new Response(version)
    conversions++
    assert.ok(options?.body instanceof FormData)
    onConvert(new URL(String(input)).pathname, options.body)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  return { fetcher, count: () => conversions }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9.2 composition', () => {
  it('registers a 9.2-only standalone PDF tool and sends flat form fields to /compose', () => {
    const operation = getOperation('compose-pages')
    assert.equal(operation.path, '/forms/pdf/compose')
    assert.equal(operation.output, 'pdf')
    assert.match(
      unavailableOperationReason({ online: true, version: '9.1.9', modules: [] }, operation) ?? '',
      /9\.2/,
    )
    assert.equal(
      unavailableOperationReason({ online: true, version: '9.2.0', modules: [] }, operation),
      null,
    )

    const placements = [
      { sourcePage: 0, page: 0, x: 36, y: 72.5, scale: 0.5, rotation: 90 },
      { sourcePage: 2, page: 1, x: -12, y: 0, scale: 1.25, rotation: 0 },
    ]
    const result = composeForm({
      paperSize: 'Letter',
      paperWidth: '15.24cm',
      placements: JSON.stringify(placements),
    })
    assert.equal(result.path, '/forms/pdf/compose')
    assert.deepEqual(JSON.parse(String(result.form.get('placements'))), placements)
    assert.equal(result.form.get('paperSize'), 'Letter')
    assert.equal(result.form.get('paperWidth'), '15.24cm')
    assert.equal(result.form.get('paperHeight'), null)
    assert.equal(result.form.getAll('files').length, 1)
    assert.equal(result.form.get('stages'), null)
  })

  it('accepts custom sizes without a preset and preserves named multi-document placements', () => {
    const stages = [
      {
        op: 'compose',
        paperWidth: '6',
        paperHeight: '360pt',
        placements: [
          { source: 'cafe\u0301.pdf', sourcePage: 1, x: 40 },
          { source: 'second.pdf', page: 2, y: 60 },
        ],
      },
    ]
    const parsed = parsePdfPipeline(JSON.stringify(stages), { assetNames: [] })
    assert.deepEqual(parsed[0]?.placements, [
      { source: 'caf\u00e9.pdf', sourcePage: 1, x: 40 },
      { source: 'second.pdf', page: 2, y: 60 },
    ])
    assert.deepEqual(pdfStageAssetNames(parsed), [])
    const result = adaptPdfPipeline(
      { operation: 'pdf-pipeline', fields: { stages: JSON.stringify(stages) }, advanced: {} },
      legacyFiles(pdf('café.pdf'), pdf('second.pdf')),
      [],
    )
    assert.deepEqual(
      (result.form.getAll('files') as File[]).map((file) => file.name),
      ['café.pdf', 'second.pdf'],
    )
    assert.deepEqual(JSON.parse(String(result.form.get('stages'))), parsed)
    assert.deepEqual(pipelineResponseTypes(parsed), ['application/pdf'])
    assert.deepEqual(pipelineResponseTypes([{ op: 'split', every: 1 }, ...parsed]), [
      'application/pdf',
    ])
  })

  it('rejects unsupported sizes, missing sizing, malformed placement objects and invalid coordinates', () => {
    for (const [stage, expression] of [
      [{ placements: [{}] }, /paperSize|paperWidth/],
      [{ paperWidth: '6in', placements: [{}] }, /paperWidth and paperHeight/],
      [{ paperSize: 'A0', placements: [{}] }, /unsupported paperSize/],
      [{ paperSize: 'A4', paperHeight: '2ft', placements: [{}] }, /paperHeight/],
      [{ paperSize: 'A4', paperWidth: '0', placements: [{}] }, /paperWidth/],
      [{ paperSize: 'A4', placements: [] }, /placements/],
      [{ paperSize: 'A4', placements: [{ sourcePage: -1 }] }, /placements entry/],
      [{ paperSize: 'A4', placements: [{ page: 1.5 }] }, /placements entry/],
      [{ paperSize: 'A4', placements: [{ scale: 0 }] }, /placements entry/],
      [{ paperSize: 'A4', placements: [{ x: '36' }] }, /placements entry/],
      [{ paperSize: 'A4', placements: [{ rotation: null }] }, /placements entry/],
      [{ paperSize: 'A4', placements: [{ unknown: true }] }, /placements entry/],
    ] as const) {
      assert.throws(
        () => parsePdfPipeline(JSON.stringify([{ op: 'compose', ...stage }])),
        expression,
      )
    }
    assert.throws(() => composeForm({ placements: '{' }), /valid JSON/)
    assert.throws(() => composeForm({ placements: '[]' }), /placements/)
  })

  it('gates standalone and pipeline composition on the detected server release', async () => {
    const older = server('9.1.0', () => assert.fail('9.1 must not receive compose'))
    for (const [op, fields] of [
      ['compose-pages', { ...operationDefaults(getOperation('compose-pages')) }],
      ['pdf-pipeline', { stages: '[{"op":"compose","paperSize":"A4","placements":[{}]}]' }],
    ] as const) {
      await assert.rejects(
        proxyConversionRequest(request(op, fields), older.fetcher),
        /9\.2 or newer/,
      )
    }
    assert.equal(older.count(), 0)
    const current = server('9.2.0', (path, form) => {
      assert.equal(path, '/forms/pdf/compose')
      assert.deepEqual(JSON.parse(String(form.get('placements'))), [{ x: 0, y: 0 }])
    })
    assert.equal(
      (
        await proxyConversionRequest(
          request('compose-pages', operationDefaults(getOperation('compose-pages'))),
          current.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(current.count(), 1)
  })
})

describe('Gotenberg 9.2 page-selection grammar', () => {
  it('accepts inclusions, exclusions, open-ended ranges and mixed selectors', () => {
    for (const selection of [
      '!1',
      '3-',
      '-3',
      'odd,!1',
      '!last',
      'all',
      'last',
      '1-3,!2',
      '!3-',
      '!-3',
      'even, !last',
    ]) {
      assert.equal(isPdfPageSelector(selection), true, selection)
    }
    for (const selection of [
      '',
      '!0',
      'all,!1',
      '1,,2',
      '--3',
      '-0',
      '0-',
      '2--',
      '! all',
      '1-2-3',
      '!',
    ]) {
      assert.equal(isPdfPageSelector(selection), false, selection)
    }
    assert.equal(hasGotenberg92PageSyntax('odd,!1'), true)
    assert.equal(hasGotenberg92PageSyntax('3-'), true)
    assert.equal(hasGotenberg92PageSyntax('-3'), true)
    assert.equal(hasGotenberg92PageSyntax('1-3,last'), false)
    assert.equal(hasGotenberg92PageSyntax(undefined), false)
    const stages = parsePdfPipeline(
      JSON.stringify([
        { op: 'split', ranges: ['3-', '!last'] },
        { op: 'insert', source: 'supplement.pdf', sourcePages: '-3' },
        { op: 'rotate', angle: 90, pages: '!1' },
      ]),
    )
    assert.equal(stagesUseGotenberg92PageSyntax(stages), true)
    assert.equal(stagesUseGotenberg92PageSyntax([{ op: 'rotate', pages: '2-4' }]), false)
  })

  it('rejects 9.2 selectors for older servers on standalone and legacy PDF tools', async () => {
    const older = server('9.1.0', () => assert.fail('9.1 must not receive 9.2 page selectors'))
    for (const [operation, fields] of [
      ['select-pages', { pages: 'odd,!1' }],
      ['delete-pages', { pages: '!last' }],
      ['pdf-form', { pages: '3-' }],
      ['extract-text', { pages: '-3' }],
      ['rotate', { rotateAngle: '90', rotatePages: '!1' }],
      ['stamp', { stampSource: 'text', stampExpression: 'APPROVED', stampPages: '3-' }],
      [
        'watermark',
        { watermarkSource: 'text', watermarkExpression: 'DRAFT', watermarkPages: '!last' },
      ],
      ['split', { splitMode: 'pages', splitSpan: '!1', splitUnify: true }],
      ['pdf-pipeline', { stages: '[{"op":"select","pages":"!last"}]' }],
    ] as const) {
      await assert.rejects(
        proxyConversionRequest(request(operation, fields), older.fetcher),
        /9\.2 or newer/,
      )
    }
    assert.equal(older.count(), 0)
    assert.match(
      pdfPipelineEditorError('[{"op":"select","pages":"!last"}]', {
        ...editorOptions,
        backendVersion: '9.1.0',
      }) ?? '',
      /9\.2/,
    )
    assert.equal(
      pdfPipelineEditorError('[{"op":"select","pages":"!last"}]', {
        ...editorOptions,
        backendVersion: '9.2.0',
      }),
      null,
    )
  })

  it('forwards selectors unchanged to the 9.2 PDF API', async () => {
    const current = server('9.2.0', (path, form) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'select', pages: 'odd,!1' }])
    })
    assert.equal(
      (await proxyConversionRequest(request('select-pages', { pages: 'odd,!1' }), current.fetcher))
        .status,
      200,
    )
    assert.equal(current.count(), 1)
  })
})

describe('Gotenberg 9.2 remote filenames', () => {
  it('sends explicit filenames or legacy editor hints as the official filename, preserving headers', () => {
    const operation = getOperation('office-pdf')
    const rows = remoteInputsPayload(
      [
        {
          id: 1,
          url: 'https://cdn.example.test/object?id=123',
          filename: 'report.docx',
          field: '',
          headers: [{ id: 2, name: 'Authorization', value: 'Bearer private' }],
        },
      ],
      '',
    )
    const payload = validatePayload({
      operation: 'office-pdf',
      fields: {},
      advanced: {},
      downloadFrom: rows,
    }).payload
    const form = createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
      major: 9,
      minor: 2,
      patch: 0,
    })
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
      {
        url: 'https://cdn.example.test/object?id=123',
        extraHttpHeaders: { Authorization: 'Bearer private' },
        filename: 'report.docx',
      },
    ])
    const raw = validatePayload({
      operation: 'office-pdf',
      fields: {},
      advanced: {},
      downloadFrom: [{ url: 'https://cdn.example.test/object', filename: 'custom.pdf' }],
    }).payload
    const encoded = createGotenbergForm(operation, raw, [], [], 4_000_000, {}, [], 9, {
      major: 9,
      minor: 2,
      patch: 0,
    })
    assert.deepEqual(JSON.parse(String(encoded.get('downloadFrom'))), [
      { url: 'https://cdn.example.test/object', filename: 'custom.pdf' },
    ])
  })

  it('preserves 9.1 hints without sending new fields and rejects explicit 9.2-only overrides', () => {
    const operation = getOperation('office-pdf')
    const version = { major: 9, minor: 1, patch: 0 }
    const hint = validatePayload({
      operation: 'office-pdf',
      fields: {},
      advanced: {},
      downloadFrom: [{ url: 'https://cdn.example.test/object', name: 'hint.pdf' }],
    }).payload
    assert.deepEqual(
      JSON.parse(
        String(
          createGotenbergForm(operation, hint, [], [], 4_000_000, {}, [], 9, version).get(
            'downloadFrom',
          ),
        ),
      ),
      [{ url: 'https://cdn.example.test/object' }],
    )
    const override = validatePayload({
      operation: 'office-pdf',
      fields: {},
      advanced: {},
      downloadFrom: [{ url: 'https://cdn.example.test/object', filename: 'report.pdf' }],
    }).payload
    assert.throws(
      () => createGotenbergForm(operation, override, [], [], 4_000_000, {}, [], 9, version),
      /9\.2 or newer/,
    )
    assert.throws(
      () =>
        validatePayload({
          operation: 'office-pdf',
          fields: {},
          advanced: {},
          downloadFrom: [
            { url: 'https://cdn.example.test/object', name: 'first.pdf', filename: 'second.pdf' },
          ],
        }),
      /conflicting/,
    )
  })

  it('passes downloadFrom.filename through the proxy and preflights referenced remote PDF stage assets', async () => {
    const current = server('9.2.0', (path, form) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
        { url: 'https://cdn.example.test/blob', filename: 'stamp.png' },
      ])
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'stamp-image', image: 'stamp.png' },
      ])
    })
    const response = await proxyConversionRequest(
      request(
        'pdf-pipeline',
        { stages: '[{"op":"stamp-image","image":"stamp.png"}]' },
        {
          downloadFrom: [{ url: 'https://cdn.example.test/blob', filename: 'stamp.png' }],
        },
      ),
      current.fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(current.count(), 1)
    assert.equal(
      pdfPipelineEditorError('[{"op":"stamp-image","image":"stamp.png"}]', {
        ...editorOptions,
        backendVersion: '9.2.0',
        remoteJson: '[{"url":"https://cdn.example.test/blob","filename":"stamp.png"}]',
      }),
      null,
    )
  })

  it('explains filename fallback and distinction from older server versions in the UI', () => {
    const row: RemoteInputRow = {
      id: 1,
      url: 'https://cdn.example.test/object',
      filename: 'stamp.png',
      field: '',
      headers: [],
    }
    const render = (backendVersion: string) =>
      renderToStaticMarkup(
        createElement(RemoteInputsEditor, {
          isV9: true,
          backendVersion,
          rows: [row],
          onChange: vi.fn(),
          legacy: '',
          onLegacyChange: vi.fn(),
          newId: () => 2,
        }),
      )
    const newer = render('9.2.0')
    assert.match(newer, /Downloaded filename/)
    assert.match(newer, /Content-Disposition/)
    assert.match(newer, /URL path/)
    const older = render('9.1.0')
    assert.match(older, /Expected filename/)
    assert.match(older, /Preflight hint only/)
  })
})
