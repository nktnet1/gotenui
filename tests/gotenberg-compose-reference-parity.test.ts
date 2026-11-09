import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { adaptConversionForm } from '#/lib/gotenberg-conversion-adapter'
import { proxyConversionRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'
import { reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import type { ConversionPayload } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'
import { zipFixture } from './fixtures/zip'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

type Options = {
  operation?: 'pdf-pipeline' | 'office-pdf'
  names?: string[]
  stages: unknown[]
  merge?: boolean
  remotes?: Array<{ url: string; filename?: string; name?: string }>
  archives?: File[]
  stageFiles?: File[]
}

function request(options: Options): Request {
  const body = new FormData()
  const operation = options.operation ?? 'office-pdf'
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields:
        operation === 'office-pdf'
          ? { merge: options.merge ?? false }
          : { stages: JSON.stringify(options.stages) },
      advanced: {},
      ...(operation === 'office-pdf' ? { conversionStages: JSON.stringify(options.stages) } : {}),
      ...(options.remotes ? { downloadFrom: options.remotes } : {}),
    }),
  )
  for (const name of options.names ??
    (operation === 'office-pdf' ? ['report.docx'] : ['report.pdf'])) {
    body.append(
      'files',
      new File([operation === 'office-pdf' ? 'Office document' : '%PDF-1.7\n'], name),
      name,
    )
  }
  for (const file of options.archives ?? []) body.append('archives', file, file.name)
  for (const file of options.stageFiles ?? []) {
    body.append(operation === 'office-pdf' ? 'stageFile' : 'auxiliary', file, file.name)
  }
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

async function forwarded(options: Options): Promise<{
  status: number
  error: string
  names: string[]
  stages: unknown[]
  remotes: unknown[]
  calls: number
}> {
  const output = {
    status: 0,
    error: '',
    names: [] as string[],
    stages: [] as unknown[],
    remotes: [] as unknown[],
    calls: 0,
  }
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response('9.2.0')
    output.calls++
    assert.equal(
      new URL(String(url)).pathname,
      options.operation === 'pdf-pipeline' ? '/forms/pdf/pipe' : '/forms/libreoffice/convert',
    )
    assert.ok(init?.body instanceof FormData)
    output.names = init.body
      .getAll('files')
      .map((entry) => (entry instanceof File ? entry.name : ''))
    output.stages = JSON.parse(String(init.body.get('stages')))
    output.remotes = JSON.parse(String(init.body.get('downloadFrom') ?? '[]'))
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(request(options), fetcher).catch(proxyErrorResponse)
  output.status = response.status
  output.error = response.status === 200 ? '' : await response.text()
  if (response.status === 200) await response.body?.cancel()
  return output
}

const compose = (source?: string) => ({
  op: 'compose',
  paperSize: 'A4',
  placements: [source === undefined ? { x: 12 } : { source, x: 12 }],
})

describe('Gotenberg 9.2 compose source reconciliation', () => {
  it('uses source omission for merge and compose stages with a single current PDF', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, compose('not-the-generated-filename.pdf'), compose('anything.pdf')],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['01_z.docx', '02_a.docx'])
    assert.deepEqual(result.stages, [{ op: 'merge' }, compose(), compose()])
  })

  it('preserves upload order and composes after merging with unnamed remote inputs', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, compose('z.docx.pdf')],
      remotes: [{ url: 'https://files.example.test/dynamic' }],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['01_z.docx', '02_a.docx'])
    assert.deepEqual(result.stages, [{ op: 'merge' }, compose()])
  })

  it('maps a renamed Office source to the zero-based split output after merge', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('z.docx_1.pdf')],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['01_z.docx', '02_a.docx'])
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      compose('01_z.docx_1.pdf'),
    ])
  })

  it('supports a stable 9.2 remote Office filename through merge and split', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('z.docx_0.pdf')],
      remotes: [{ url: 'https://files.example.test/document', filename: 'remote.docx' }],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.remotes, [
      { url: 'https://files.example.test/document', filename: 'remote.docx' },
    ])
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      compose('01_z.docx_0.pdf'),
    ])
  })

  it('handles ZIP sources that sort ahead of the first local Office document', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      archives: [zipFixture({ '00_archived.docx': 'from ZIP' })],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('00_archived.docx_0.pdf')],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      compose('00_archived.docx_0.pdf'),
    ])
  })

  it('accepts a single fixed split range and omits the compose source even with unnamed remote inputs', async () => {
    const result = await forwarded({
      stages: [{ op: 'merge' }, { op: 'split', ranges: ['1'] }, compose('unknown.pdf')],
      remotes: [{ url: 'https://files.example.test/dynamic' }],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.stages, [{ op: 'merge' }, { op: 'split', ranges: ['1'] }, compose()])
  })

  it('requires stable input names when a split follows an unknown remote merge', async () => {
    const result = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('z.docx_0.pdf')],
      remotes: [{ url: 'https://files.example.test/dynamic' }],
    })
    assert.equal(result.status, 400)
    assert.equal(result.calls, 0)
    assert.match(result.error, /cannot resolve filenames after split/)
    assert.match(result.error, /downloadFrom filename overrides/)
  })

  it('rejects a pre-split filename and a missing source rather than forwarding a broken compose', async () => {
    const wrong = await forwarded({
      names: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('z.docx.pdf')],
    })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.calls, 0)
    assert.match(wrong.error, /01_z\.docx_0\.pdf/)
    const missing = await forwarded({
      stages: [{ op: 'split', every: 1 }, compose()],
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.calls, 0)
    assert.match(missing.error, /needs a source after split/)
  })

  it('applies the same single-source rule to PDF pipeline merge and compose, including ZIPs', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['z.pdf', 'a.pdf'],
      archives: [zipFixture({ '00_other.pdf': '%PDF-1.7\n' })],
      stages: [{ op: 'merge' }, compose('z.pdf')],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['01_z.pdf', '02_a.pdf'])
    assert.deepEqual(result.stages, [{ op: 'merge' }, compose()])
  })

  it('tracks PDF split names from the current filename, including a renamed source', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['z.pdf', 'a.pdf'],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose('z_2.pdf')],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      compose('01_z_2.pdf'),
    ])
  })

  it('keeps genuine multi-PDF compose references before a merge', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['z.pdf', 'a.pdf'],
      stages: [
        { op: 'compose', paperSize: 'A4', placements: [{ source: 'z.pdf' }, { source: 'a.pdf' }] },
        { op: 'merge' },
      ],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['z.pdf', 'a.pdf'])
    assert.deepEqual(result.stages, [
      { op: 'compose', paperSize: 'A4', placements: [{ source: 'z.pdf' }, { source: 'a.pdf' }] },
      { op: 'merge' },
    ])
  })

  it('ignores a referenced ZIP stage asset when identifying PDF inputs', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['report.pdf'],
      archives: [zipFixture({ '00_overlay.pdf': '%PDF-1.7\n' })],
      stages: [
        { op: 'split', every: 1 },
        compose('report_0.pdf'),
        { op: 'stamp-pdf', source: '00_overlay.pdf', x: 0, y: 0 },
      ],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.stages[1], compose('report_0.pdf'))
  })
})

describe('compose stage filename validation', () => {
  const editor = {
    localAssetNames: [] as string[],
    remoteRows: [],
    remoteJson: '',
    archivesPresent: false,
    acknowledgedRedaction: false,
    backendVersion: '9.2.0',
    documentNames: ['report.pdf'],
    documentKind: 'pdf' as const,
  }

  it('preflights missing and stale split source references with meaningful errors', () => {
    assert.match(
      pdfPipelineEditorError(JSON.stringify([{ op: 'split', every: 1 }, compose()]), editor) ?? '',
      /needs a source after split/,
    )
    assert.match(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'split', every: 1 }, compose('report.pdf')]),
        editor,
      ) ?? '',
      /report_0\.pdf/,
    )
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'split', every: 1 }, compose('report_0.pdf')]),
        editor,
      ),
      null,
    )
  })

  it('recognises the built-in Office merge and permits source omission', () => {
    assert.equal(
      pdfPipelineEditorError(JSON.stringify([compose('not-a-generated-name.pdf')]), {
        ...editor,
        documentKind: 'office',
        documentNames: ['z.docx', 'a.docx'],
        builtInMerge: true,
      }),
      null,
    )
  })

  it('requires a remote filename hint before resolving split outputs', () => {
    const stages = JSON.stringify([
      { op: 'merge' },
      { op: 'split', every: 1 },
      compose('report_0.pdf'),
    ])
    assert.match(
      pdfPipelineEditorError(stages, {
        ...editor,
        remoteJson: '[{"url":"https://files.example.test/dynamic"}]',
      }) ?? '',
      /filename overrides/,
    )
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'merge' }, { op: 'split', every: 1 }, compose('later_0.pdf')]),
        {
          ...editor,
          remoteJson: '[{"url":"https://files.example.test/dynamic","filename":"later.pdf"}]',
        },
      ),
      null,
    )
  })

  it('does not mistake a remote PDF overlay for an Office document input', () => {
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([
          { op: 'merge' },
          { op: 'split', every: 1 },
          compose('report.docx_0.pdf'),
          { op: 'stamp-pdf', source: 'overlay.pdf', x: 0, y: 0 },
        ]),
        {
          ...editor,
          documentKind: 'office',
          documentNames: ['report.docx'],
          remoteJson: '[{"url":"https://files.example.test/overlay","filename":"overlay.pdf"}]',
        },
      ),
      null,
    )
  })

  it('resolves Chromium split filenames only when an output name is set', () => {
    const stages = [{ op: 'split', every: 1 }, compose('stable_0.pdf')]
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'single',
        documentNames: [],
        outputName: 'stable',
      }),
      null,
    )
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'single',
        documentNames: [],
      }) ?? '',
      /Chromium output filename/,
    )

    const operation = OPERATION_BY_ID.get('html-pdf')
    assert.ok(operation)
    const payload: ConversionPayload = {
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      outputName: 'stable',
      conversionStages: JSON.stringify(stages),
    }
    const form = adaptConversionForm(operation, payload, new FormData(), 9)
    assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
    assert.throws(
      () =>
        adaptConversionForm(operation, { ...payload, outputName: undefined }, new FormData(), 9),
      /Chromium output filename/,
    )
  })

  it('ignores remote PDF overlays when identifying Chromium split outputs', () => {
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([
          { op: 'split', every: 1 },
          compose('stable_0.pdf'),
          { op: 'stamp-pdf', source: 'overlay.pdf', x: 0, y: 0 },
        ]),
        {
          ...editor,
          documentKind: 'single',
          documentNames: [],
          outputName: 'stable',
          remoteJson: '[{"url":"https://files.example.test/overlay","filename":"overlay.pdf"}]',
        },
      ),
      null,
    )
  })

  it('defers ZIP-only input names to the server without inventing a client-side filename', () => {
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'merge' }, { op: 'split', every: 1 }, compose('00_archived_0.pdf')]),
        {
          ...editor,
          documentNames: [],
          archivesPresent: true,
        },
      ),
      null,
    )
  })

  it('uses Gotenberg filename sorting for equal numeric suffixes and large numeric prefixes', () => {
    const stages = parsePdfPipeline(
      JSON.stringify([{ op: 'merge' }, { op: 'split', every: 1 }, compose('invoice01_0.pdf')]),
    )
    const sorted = reconcilePdfComposeSources(stages, {
      inputs: [
        { original: 'invoice1.pdf', forwarded: 'invoice1.pdf' },
        { original: 'invoice01.pdf', forwarded: 'invoice01.pdf' },
      ],
    })
    assert.deepEqual(sorted[2], compose('invoice01_0.pdf'))

    const largeStages = parsePdfPipeline(
      JSON.stringify([
        { op: 'merge' },
        { op: 'split', every: 1 },
        compose('9007199254740993_0.pdf'),
      ]),
    )
    const largePrefix = reconcilePdfComposeSources(largeStages, {
      inputs: [
        { original: '9223372036854775807.pdf', forwarded: '9223372036854775807.pdf' },
        { original: '9007199254740993.pdf', forwarded: '9007199254740993.pdf' },
      ],
    })
    assert.deepEqual(largePrefix[2], compose('9007199254740993_0.pdf'))
  })

  it('supports repeated splitting and preserves names after an intervening merge', () => {
    const stages = parsePdfPipeline(
      JSON.stringify([
        { op: 'split', every: 1 },
        { op: 'split', every: 1 },
        compose('report_0_1.pdf'),
        { op: 'split', every: 1 },
        compose('report_0_0_0.pdf'),
      ]),
    )
    const output = reconcilePdfComposeSources(stages, {
      inputs: [{ original: 'report.pdf', forwarded: 'report.pdf' }],
    })
    assert.deepEqual(output[2], compose('report_0_1.pdf'))
    assert.deepEqual(output[4], compose('report_0_0_0.pdf'))
  })
})
