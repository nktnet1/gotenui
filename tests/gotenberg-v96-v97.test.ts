import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { capturePresetFields, reusableFieldNames } from '#/lib/conversion-presets'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { mapFileBookmarkLabels, validateFileBookmarks } from '#/lib/pdf-file-bookmarks'
import { PDF_PIPELINE_STAGES, parsePdfPipeline } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { PDF_REWRITING_STAGES, PDF_REWRITING_TOOLS } from '#/lib/pdf-signature-removal'
import { activeOperationFields, OPERATION_BY_ID, operationDefaults } from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'
import type { FieldDefinition } from '#/tools/types'

const upstream = 'http://127.0.0.1:3000'
const origin = 'https://gotenui.example.test'
const testPdf = (name: string) => new File(['%PDF-1.7\nfixture'], name, { type: 'application/pdf' })

function request(
  id: string,
  fields: Record<string, string | boolean> = {},
  options: {
    files?: File[]
    conversionStages?: unknown[]
    stages?: unknown[]
    sourceFiles?: File[]
  } = {},
): Request {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation, id)
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: id,
      fields: {
        ...operationDefaults(operation),
        ...fields,
        ...(options.stages ? { stages: JSON.stringify(options.stages) } : {}),
      },
      advanced: {},
      ...(options.conversionStages
        ? { conversionStages: JSON.stringify(options.conversionStages) }
        : {}),
      ...(id === 'html-pdf' ? { source: '<!doctype html><h1>Example</h1>' } : {}),
    }),
  )
  for (const file of options.files ?? (operation.input === 'pdf' ? [testPdf('input.pdf')] : [])) {
    body.append('files', file, file.name)
  }
  for (const file of options.sourceFiles ?? []) body.append('files', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function server(version: string) {
  const requests: {
    path: string
    files: string[]
    stages: Record<string, unknown>[]
    form: FormData
  }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    assert.ok(init?.body instanceof FormData)
    const form = init.body
    requests.push({
      path: new URL(String(url)).pathname,
      files: form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
      stages: JSON.parse(String(form.get('stages') ?? '[]')),
      form,
    })
    return new Response('%PDF-1.7\nconverted', { headers: { 'content-type': 'application/pdf' } })
  }
  return { fetcher, requests }
}

async function convert(
  id: string,
  version: string,
  fields: Record<string, string | boolean>,
  options?: Parameters<typeof request>[2],
) {
  const remote = server(version)
  const response = await proxyConversionRequest(request(id, fields, options), remote.fetcher)
  assert.equal(response.status, 200)
  await response.body?.cancel()
  const result = remote.requests[0]
  assert.ok(result)
  return result
}

const editor = {
  localAssetNames: [] as string[],
  archivesPresent: false,
  remoteRows: [],
  remoteJson: '',
  acknowledgedRedaction: true,
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9.6 explicit digital-signature removal', () => {
  it('permits dropSignatures only on the fourteen upstream rewriting stages', () => {
    assert.deepEqual(
      [...PDF_REWRITING_STAGES],
      [
        'merge',
        'split',
        'select',
        'delete',
        'insert',
        'compose',
        'flatten-form',
        'flatten-transparency',
        'convert-colors',
        'redact',
        'optimize',
        'encrypt',
        'decrypt',
        'remediate',
      ],
    )
    const cases: Record<string, Record<string, unknown>> = {
      merge: {},
      split: { every: 1 },
      select: { pages: '1' },
      delete: { pages: '1' },
      insert: { source: 'extra.pdf', at: 0 },
      compose: { paperSize: 'A4', placements: [{ page: 1, sourcePage: 1 }] },
      'flatten-form': {},
      'flatten-transparency': {},
      'convert-colors': { target: 'rgb' },
      redact: { regions: [{ page: 1, width: 12, height: 12 }] },
      optimize: {},
      encrypt: { userPassword: 'password' },
      decrypt: { password: 'password' },
      remediate: { profile: 'PDF/A-2b' },
    }
    for (const [op, options] of Object.entries(cases)) {
      const stage = { op, ...options, dropSignatures: true }
      assert.deepEqual(
        parsePdfPipeline(JSON.stringify([stage]), {
          acknowledgedRedaction: true,
          assetNames: ['extra.pdf'],
        }),
        [stage],
        op,
      )
      assert.ok(
        PDF_PIPELINE_STAGES.find((item) => item.op === op)?.fields.some(
          (name) => name === 'dropSignatures',
        ),
      )
      assert.throws(
        () => parsePdfPipeline(JSON.stringify([{ ...stage, dropSignatures: 'true' }])),
        /dropSignatures.*true or false/,
        op,
      )
    }
    for (const op of ['rotate', 'stamp-text', 'autotag', 'set-bookmarks', 'sign']) {
      assert.ok(!PDF_REWRITING_STAGES.has(op))
      assert.throws(
        () => parsePdfPipeline(JSON.stringify([{ op, dropSignatures: true }])),
        /unknown option.*dropSignatures/i,
      )
    }
  })

  it('exposes the control on rewriting tools, never incremental editing tools', () => {
    for (const id of PDF_REWRITING_TOOLS) {
      const field = OPERATION_BY_ID.get(id)?.fields.find((item) => item.name === 'v9DropSignatures')
      assert.ok(field, id)
      assert.deepEqual(field.supportedGotenbergMajors, [9])
      assert.equal(field.minGotenbergMinor, 6)
      assert.match(field.description ?? '', /digitally signed|signature|cryptographic/i)
      const operation = OPERATION_BY_ID.get(id)
      assert.ok(operation)
      assert.ok(!reusableFieldNames(operation).includes('v9DropSignatures'))
      assert.equal(
        capturePresetFields(operation, { v9DropSignatures: true }).v9DropSignatures,
        undefined,
      )
    }
    for (const id of [
      'rotate',
      'stamp',
      'watermark',
      'metadata-write',
      'bookmarks-write',
      'sign',
    ]) {
      assert.equal(
        OPERATION_BY_ID.get(id)?.fields.some((field) => field.name === 'v9DropSignatures'),
        false,
        id,
      )
    }
  })

  it('rejects older servers before forwarding and allows 9.6+ requests', async () => {
    for (const id of ['merge', 'split', 'optimize', 'encrypt', 'compose-pages', 'decrypt']) {
      const remote = server('9.5.1')
      await assert.rejects(
        () =>
          proxyConversionRequest(
            request(id, {
              v9DropSignatures: true,
              ...(id === 'split' ? { splitMode: 'intervals', splitSpan: '2' } : {}),
              ...(id === 'encrypt' ? { userPassword: 'pass' } : {}),
              ...(id === 'decrypt' ? { password: 'pass' } : {}),
            }),
            remote.fetcher,
          ),
        { status: 409 },
        id,
      )
      assert.equal(remote.requests.length, 0)
    }
    for (const id of ['merge', 'optimize', 'flatten']) {
      const output = await convert(
        id,
        '9.6.0',
        { v9DropSignatures: true, ...(id === 'flatten' ? { v9FlattenFormsOnly: true } : {}) },
        {
          files: id === 'merge' ? [testPdf('a.pdf'), testPdf('b.pdf')] : undefined,
        },
      )
      assert.ok(output.stages.length > 0)
      for (const stage of output.stages) {
        if (PDF_REWRITING_STAGES.has(String(stage.op))) assert.equal(stage.dropSignatures, true)
        else assert.equal(stage.dropSignatures, undefined)
      }
    }
    const compose = await convert('compose-pages', '9.7.0', { v9DropSignatures: true })
    assert.equal(compose.path, '/forms/pdf/compose')
    assert.equal(compose.form.get('dropSignatures'), 'true')
  })

  it('allows existing false/default behaviour on older servers', async () => {
    const output = await convert(
      'merge',
      '9.5.1',
      { v9DropSignatures: false },
      { files: [testPdf('a.pdf'), testPdf('b.pdf')] },
    )
    assert.deepEqual(output.stages, [{ op: 'merge' }])
  })

  it('version-gates PDF editor stages and conversion-time stages', async () => {
    const stages = [{ op: 'optimize', dropSignatures: true }]
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), { ...editor, backendVersion: '9.5.1' }) ?? '',
      /9\.6 or newer/,
    )
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), { ...editor, backendVersion: '9.6.0' }),
      null,
    )
    const old = server('9.5.1')
    await assert.rejects(
      () => proxyConversionRequest(request('pdf-pipeline', {}, { stages }), old.fetcher),
      { status: 409 },
    )
    assert.equal(old.requests.length, 0)
    const current = await convert('pdf-pipeline', '9.6.0', {}, { stages })
    assert.deepEqual(current.stages, stages)
    const oldConversion = server('9.5.1')
    await assert.rejects(
      () =>
        proxyConversionRequest(
          request('html-pdf', {}, { conversionStages: stages }),
          oldConversion.fetcher,
        ),
      { status: 409 },
    )
    assert.equal(oldConversion.requests.length, 0)
  })
})

describe('Gotenberg 9.7 per-file merge bookmarks', () => {
  it('validates the upstream JSON option schema and rejects malformed labels', () => {
    for (const bookmarks of [
      {},
      { label: ['title'] },
      { label: ['filename'] },
      { label: ['title', 'filename'], labels: { 'one.pdf': 'One' } },
      { labels: {} },
    ]) {
      assert.doesNotThrow(() => validateFileBookmarks(bookmarks))
      const stage = [{ op: 'merge', fileBookmarks: bookmarks }]
      assert.deepEqual(parsePdfPipeline(JSON.stringify(stage)), stage)
    }
    for (const bookmarks of [
      null,
      [],
      'filename',
      { label: 'title' },
      { label: ['subject'] },
      { label: [1] },
      { labels: [] },
      { labels: { 'a.pdf': '' } },
      { labels: { 'a.pdf': '  ' } },
      { unknown: true },
    ]) {
      assert.throws(() => validateFileBookmarks(bookmarks), /fileBookmarks/)
      if (bookmarks !== null) {
        assert.throws(
          () => parsePdfPipeline(JSON.stringify([{ op: 'merge', fileBookmarks: bookmarks }])),
          /fileBookmarks/,
        )
      }
    }
    assert.throws(
      () => parsePdfPipeline('[{"op":"split","every":1,"fileBookmarks":{}}]'),
      /unknown option.*fileBookmarks/i,
    )
  })

  it('preserves per-file labels across prefix renaming and duplicate originals', () => {
    const mapped = mapFileBookmarkLabels(
      { label: ['filename'], labels: { 'report.pdf': 'Report', 'remote.pdf': 'Remote' } },
      [
        { original: 'report.pdf', forwarded: '01_report.pdf' },
        { original: 'report.pdf', forwarded: '02_report.pdf' },
      ],
    )
    assert.deepEqual(
      { ...mapped.labels },
      {
        '01_report.pdf': 'Report',
        '02_report.pdf': 'Report',
        'remote.pdf': 'Remote',
      },
    )
    assert.deepEqual(
      {
        ...mapFileBookmarkLabels({ label: ['filename'] }, [
          { original: 'file.pdf', forwarded: '01_file.pdf' },
        ]).labels,
      },
      { '01_file.pdf': 'file' },
    )
  })

  it('maps standalone merge labels to the actual forwarded filenames', async () => {
    const options = { files: [testPdf('report.pdf'), testPdf('annex.pdf')] }
    const output = await convert(
      'merge',
      '9.7.0',
      {
        v9FileBookmarks: true,
        v9FileBookmarkSource: 'filename',
        v9FileBookmarkLabels: JSON.stringify({ 'report.pdf': 'Annual report' }),
      },
      options,
    )
    assert.deepEqual(output.files, ['01_report.pdf', '02_annex.pdf'])
    assert.deepEqual(output.stages, [
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: {
            '01_report.pdf': 'Annual report',
            '02_annex.pdf': 'annex',
          },
        },
      },
    ])
    const defaultOutput = await convert('merge', '9.7.0', { v9FileBookmarks: true }, options)
    assert.deepEqual(defaultOutput.stages, [{ op: 'merge', fileBookmarks: {} }])
  })

  it('maps pipeline labels before merging, but does not add numbering to the defaults', async () => {
    const options = {
      stages: [
        { op: 'merge', fileBookmarks: { label: ['filename'], labels: { 'report.pdf': 'R' } } },
      ],
      files: [testPdf('report.pdf'), testPdf('annex.pdf')],
    }
    const output = await convert('pdf-pipeline', '9.7.0', {}, options)
    assert.deepEqual(output.files, ['01_report.pdf', '02_annex.pdf'])
    assert.deepEqual(output.stages, [
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: { '01_report.pdf': 'R', '02_annex.pdf': 'annex' },
        },
      },
    ])
  })

  it('maps conversion-pipeline labels on numbered Office inputs', async () => {
    const output = await convert(
      'office-pdf',
      '9.7.0',
      { merge: false },
      {
        files: [new File(['office'], 'report.docx'), new File(['office'], 'annex.docx')],
        conversionStages: [
          {
            op: 'merge',
            fileBookmarks: { label: ['filename'], labels: { 'report.docx.pdf': 'Office report' } },
          },
        ],
      },
    )
    assert.deepEqual(output.files, ['01_report.docx', '02_annex.docx'])
    assert.deepEqual(output.stages, [
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: { '01_report.docx.pdf': 'Office report', '02_annex.docx.pdf': 'annex.docx' },
        },
      },
    ])
  })

  it('maps PDF pipeline custom labels after filename-preserving edits', async () => {
    const beforeMerge = { op: 'rotate', angle: 90 }
    const output = await convert(
      'pdf-pipeline',
      '9.7.0',
      {},
      {
        files: [testPdf('report.pdf'), testPdf('annex.pdf')],
        stages: [
          beforeMerge,
          {
            op: 'merge',
            fileBookmarks: { label: ['filename'], labels: { 'report.pdf': 'Report' } },
          },
        ],
      },
    )
    assert.deepEqual(output.files, ['01_report.pdf', '02_annex.pdf'])
    assert.deepEqual(output.stages, [
      beforeMerge,
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: { '01_report.pdf': 'Report', '02_annex.pdf': 'annex' },
        },
      },
    ])
  })

  it.each([{ op: 'rotate', angle: 90 }, { op: 'optimize' }, { op: 'select', pages: '1' }])(
    'maps Office merge labels after a filename-preserving $op stage',
    async (beforeMerge) => {
      const output = await convert(
        'office-pdf',
        '9.7.0',
        { merge: false },
        {
          files: [new File(['office'], 'report.docx'), new File(['office'], 'annex.docx')],
          conversionStages: [
            beforeMerge,
            {
              op: 'merge',
              fileBookmarks: {
                label: ['filename'],
                labels: { 'report.docx.pdf': 'Office report' },
              },
            },
          ],
        },
      )
      assert.deepEqual(output.files, ['01_report.docx', '02_annex.docx'])
      assert.deepEqual(output.stages, [
        beforeMerge,
        {
          op: 'merge',
          fileBookmarks: {
            label: ['filename'],
            labels: { '01_report.docx.pdf': 'Office report', '02_annex.docx.pdf': 'annex.docx' },
          },
        },
      ])
    },
  )

  it('preserves actual split output names in Office conversion merge labels', async () => {
    const stages = [
      { op: 'split', every: 1 },
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: { '01_report.docx_0.pdf': 'First part' },
        },
      },
    ]
    const output = await convert(
      'office-pdf',
      '9.7.0',
      { merge: false },
      {
        files: [new File(['office'], 'report.docx'), new File(['office'], 'annex.docx')],
        conversionStages: stages,
      },
    )
    assert.deepEqual(output.files, ['01_report.docx', '02_annex.docx'])
    assert.deepEqual(output.stages, stages)
  })

  it('does not invent stale bookmark labels after split before merge', async () => {
    const stages = [
      { op: 'split', every: 1 },
      { op: 'merge', fileBookmarks: { label: ['filename'] } },
    ]
    const output = await convert(
      'pdf-pipeline',
      '9.7.0',
      {},
      {
        files: [testPdf('report.pdf'), testPdf('annex.pdf')],
        stages,
      },
    )
    assert.deepEqual(output.files, ['01_report.pdf', '02_annex.pdf'])
    assert.deepEqual(output.stages, stages)
  })

  it('retains merge-stage filenames for explicit labels after splitting', async () => {
    const stages = [
      { op: 'split', every: 1 },
      {
        op: 'merge',
        fileBookmarks: {
          label: ['filename'],
          labels: { '01_report_0.pdf': 'First section' },
        },
      },
    ]
    const output = await convert(
      'pdf-pipeline',
      '9.7.0',
      {},
      {
        files: [testPdf('report.pdf'), testPdf('annex.pdf')],
        stages,
      },
    )
    assert.deepEqual(output.stages, stages)
  })

  it('does not invent obsolete per-input labels after compose before merge', async () => {
    const stages = [
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [
          { source: 'report.pdf', sourcePage: 1, page: 1, x: 0, y: 0 },
          { source: 'annex.pdf', sourcePage: 1, page: 2, x: 0, y: 0 },
        ],
      },
      { op: 'merge', fileBookmarks: { label: ['filename'] } },
    ]
    const output = await convert(
      'pdf-pipeline',
      '9.7.0',
      {},
      {
        files: [testPdf('report.pdf'), testPdf('annex.pdf')],
        stages,
      },
    )
    assert.deepEqual(output.stages, stages)
  })

  it('rejects unsupported server versions for standalone, PDF and conversion pipelines', async () => {
    const cases: [string, Record<string, string | boolean>, Parameters<typeof request>[2]][] = [
      ['merge', { v9FileBookmarks: true }, { files: [testPdf('a.pdf'), testPdf('b.pdf')] }],
      ['pdf-pipeline', {}, { stages: [{ op: 'merge', fileBookmarks: {} }] }],
      ['html-pdf', {}, { conversionStages: [{ op: 'merge', fileBookmarks: {} }] }],
    ]
    for (const [id, fields, options] of cases) {
      const remote = server('9.6.0')
      await assert.rejects(
        () => proxyConversionRequest(request(id, fields, options), remote.fetcher),
        { status: 409 },
      )
      assert.equal(remote.requests.length, 0)
    }
    const output = await convert(
      'merge',
      '9.6.0',
      { v9FileBookmarks: false },
      { files: [testPdf('a.pdf'), testPdf('b.pdf')] },
    )
    assert.deepEqual(output.stages, [{ op: 'merge' }])
    const editorInput = JSON.stringify([{ op: 'merge', fileBookmarks: {} }])
    assert.match(
      pdfPipelineEditorError(editorInput, { ...editor, backendVersion: '9.6.0' }) ?? '',
      /9\.7 or newer/,
    )
    assert.equal(pdfPipelineEditorError(editorInput, { ...editor, backendVersion: '9.7.0' }), null)
  })

  it('disables newer controls on earlier backends without hiding the field descriptions', () => {
    const tool = OPERATION_BY_ID.get('merge')
    assert.ok(tool)
    for (const [name, version] of [
      ['v9DropSignatures', '9.5.1'],
      ['v9FileBookmarks', '9.6.0'],
    ] as const) {
      const field: FieldDefinition | undefined = tool.fields.find((item) => item.name === name)
      assert.ok(field)
      const render = renderToStaticMarkup(
        createElement(FieldControl, {
          field,
          value: false,
          backendVersion: version,
          onChange: () => {},
        }),
      )
      assert.match(render, /disabled/)
      assert.match(render, /Gotenberg 9\./)
      assert.equal(activeOperationFields(tool, { [name]: true }, version)[name], true)
      assert.equal(activeOperationFields(tool, { [name]: true }, '9.7.0')[name], true)
    }
  })
})
