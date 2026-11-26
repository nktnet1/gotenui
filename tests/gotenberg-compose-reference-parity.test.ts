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
  version?: string
  names?: string[]
  stages: unknown[]
  merge?: boolean
  split?: { splitMode: string; splitSpan: string; splitUnify?: boolean }
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
          ? { merge: options.merge ?? false, ...options.split }
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
    if (String(url) === `${upstream}/version`) return new Response(options.version ?? '9.2.0')
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

const composeMany = (...sources: string[]) => ({
  ...compose(),
  placements: sources.map((source) => ({ source, x: 12 })),
})

describe('Gotenberg 9.2 compose source reconciliation', () => {
  it('uses a nonempty remote name hint when the official filename override is empty', async () => {
    const officeStage = {
      op: 'compose',
      paperSize: 'A4',
      placements: [{ source: 'local.docx.pdf' }, { source: 'remote.docx.pdf' }],
    }
    const office = await forwarded({
      names: ['local.docx'],
      stages: [officeStage],
      remotes: [{ url: 'https://files.example.test/object', name: 'remote.docx', filename: '' }],
    })
    assert.equal(office.status, 200, office.error)
    assert.deepEqual(office.remotes, [
      { url: 'https://files.example.test/object', filename: 'remote.docx' },
    ])
    assert.deepEqual(office.stages, [officeStage])

    const pdfStage = {
      op: 'compose',
      paperSize: 'A4',
      placements: [{ source: 'local.pdf' }, { source: 'remote.pdf' }],
    }
    const pdf = await forwarded({
      operation: 'pdf-pipeline',
      names: ['local.pdf'],
      stages: [pdfStage],
      remotes: [{ url: 'https://files.example.test/object', name: 'remote.pdf', filename: '' }],
    })
    assert.equal(pdf.status, 200, pdf.error)
    assert.deepEqual(pdf.remotes, [
      { url: 'https://files.example.test/object', filename: 'remote.pdf' },
    ])
    assert.deepEqual(pdf.stages, [pdfStage])
  })

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
      stages: [
        { op: 'merge' },
        { op: 'split', every: 1 },
        composeMany('z.docx_0.pdf', 'z.docx_1.pdf'),
      ],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.names, ['01_z.docx', '02_a.docx'])
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      composeMany('01_z.docx_0.pdf', '01_z.docx_1.pdf'),
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
      stages: [
        { op: 'merge' },
        { op: 'split', every: 1 },
        composeMany('z_0.pdf', 'z_1.pdf', 'z_2.pdf'),
      ],
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', every: 1 },
      composeMany('01_z_0.pdf', '01_z_1.pdf', '01_z_2.pdf'),
    ])
  })

  it('forwards explicit split references when ZIP PDFs share a sanitized filename', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: [],
      archives: [
        zipFixture({ 'first/report.pdf': '%PDF-1.7\n', 'second/report.pdf': '%PDF-1.7\n' }),
      ],
      stages: [
        { op: 'split', ranges: ['1'] },
        {
          op: 'compose',
          paperSize: 'A4',
          placements: [{ source: 'report_0.pdf' }, { source: 'report (2)_0.pdf' }],
        },
      ],
    })
    // Gotenberg's uniqueFilename numbers the second ZIP entry before split.
    // The server can validate the explicit names, even though the client has
    // ambiguous names in its ZIP preflight summary.
    assert.equal(result.status, 200, result.error)
    assert.equal(result.calls, 1)
    assert.deepEqual(result.stages[1], {
      op: 'compose',
      paperSize: 'A4',
      placements: [{ source: 'report_0.pdf' }, { source: 'report (2)_0.pdf' }],
    })
  })

  it('forwards explicit split references when directly uploaded PDFs have the same name', async () => {
    const composition = {
      ...compose(),
      placements: [{ source: 'same_0.pdf' }, { source: 'same (2)_0.pdf' }],
    }
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['same.pdf', 'same.pdf'],
      stages: [{ op: 'split', ranges: ['1'] }, composition],
    })
    assert.equal(result.status, 200, result.error)
    assert.equal(result.calls, 1)
    assert.deepEqual(result.stages[1], composition)
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

  it('allows an explicit numbered duplicate PDF name after split while still requiring sources', () => {
    const duplicated = { ...editor, documentNames: ['same.pdf', 'same.pdf'] }
    assert.equal(
      pdfPipelineEditorError(
        JSON.stringify([
          { op: 'split', ranges: ['1'] },
          { ...compose(), placements: [{ source: 'same_0.pdf' }, { source: 'same (2)_0.pdf' }] },
        ]),
        duplicated,
      ),
      null,
    )
    assert.match(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'split', ranges: ['1'] }, compose('same (2)_0.pdf')]),
        duplicated,
      ) ?? '',
      /place every PDF/,
    )
    assert.match(
      pdfPipelineEditorError(
        JSON.stringify([{ op: 'split', ranges: ['1'] }, compose()]),
        duplicated,
      ) ?? '',
      /needs a source after split/,
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
        composeMany('report_0_0.pdf', 'report_0_1.pdf'),
        { op: 'split', every: 1 },
        compose('report_0_0_0.pdf'),
      ]),
    )
    const output = reconcilePdfComposeSources(stages, {
      inputs: [{ original: 'report.pdf', forwarded: 'report.pdf' }],
    })
    assert.deepEqual(output[2], composeMany('report_0_0.pdf', 'report_0_1.pdf'))
    assert.deepEqual(output[4], compose('report_0_0_0.pdf'))
  })
})

it.each(['pdf-pipeline', 'office-pdf'] as const)(
  'uses the pinned URL-derived %s filename when resolving a split after merge',
  async (operation) => {
    const extension = operation === 'pdf-pipeline' ? 'pdf' : 'docx'
    const remoteName = `00_remote.${extension}`
    const splitName = operation === 'pdf-pipeline' ? '00_remote_0.pdf' : '00_remote.docx_0.pdf'
    const url = `https://files.example.test/${remoteName}`
    const result = await forwarded({
      operation,
      names: [`z.${extension}`, `a.${extension}`],
      remotes: [{ url }],
      stages: [{ op: 'merge' }, { op: 'split', every: 1 }, compose(splitName)],
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.remotes, [{ url, filename: remoteName }])
    assert.deepEqual(result.stages[2], compose(splitName))
  },
)

it.each(['pdf', 'office'] as const)(
  'editor resolves split filenames using the same numbered local and pinned remote %s inputs as the proxy',
  (documentKind) => {
    const extension = documentKind === 'pdf' ? 'pdf' : 'docx'
    const remoteName = `00_remote.${extension}`
    const remoteSplit = documentKind === 'pdf' ? '00_remote_0.pdf' : '00_remote.docx_0.pdf'
    const localSplit = documentKind === 'pdf' ? 'z_0.pdf' : 'z.docx_0.pdf'
    const options = {
      localAssetNames: [],
      archivesPresent: false,
      remoteRows: [],
      remoteJson: '',
      acknowledgedRedaction: false,
      backendVersion: '9.10.0',
      documentNames: [`z.${extension}`, `a.${extension}`],
      documentKind,
    }
    const stages = (source: string) =>
      JSON.stringify([{ op: 'merge' }, { op: 'split', every: 1 }, compose(source)])
    assert.equal(pdfPipelineEditorError(stages(localSplit), options), null)
    assert.equal(
      pdfPipelineEditorError(stages(remoteSplit), {
        ...options,
        remoteJson: JSON.stringify([{ url: `https://files.example.test/${remoteName}` }]),
      }),
      null,
    )
  },
)

describe('Office conversion input order and built-in split parity', () => {
  const options = {
    localAssetNames: [],
    archivesPresent: false,
    remoteRows: [],
    remoteJson: '',
    acknowledgedRedaction: false,
    backendVersion: '9.10.0',
    documentKind: 'office' as const,
    documentNames: ['report10.docx'],
  }
  const stages = [
    { op: 'merge' },
    { op: 'split', ranges: ['1', '2'] },
    {
      op: 'compose',
      paperSize: 'A4',
      placements: [{ source: 'report2.docx_0.pdf' }, { source: 'report2.docx_1.pdf' }],
    },
  ]
  const remote = { url: 'https://files.example.test/report2.docx', filename: 'report2.docx' }

  it('sorts Office source filenames before appending the PDF extension', async () => {
    const result = await forwarded({
      version: '9.10.0',
      names: ['report10.docx'],
      remotes: [remote],
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.names, ['report10.docx'])
    assert.deepEqual(result.stages, stages)
  })

  it('sorts archive-only Office sources by their pre-conversion filenames', async () => {
    const result = await forwarded({
      version: '9.10.0',
      names: [],
      archives: [zipFixture({ 'report10.docx': 'ten', 'report2.docx': 'two' })],
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, stages)
  })

  it('preflights Office merge output in the same order as LibreOffice', () => {
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...options,
        remoteJson: JSON.stringify([remote]),
      }),
      null,
    )
  })

  it('preflights built-in split before user composition', async () => {
    const split = { splitMode: 'pages', splitSpan: '1,2' }
    const stages = [
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [
          { source: 'report10.docx_0.pdf' },
          { source: 'report10.docx_1.pdf' },
          { source: 'report2.docx_0.pdf' },
          { source: 'report2.docx_1.pdf' },
        ],
      },
    ]
    const result = await forwarded({
      version: '9.10.0',
      names: ['report10.docx', 'report2.docx'],
      stages,
      split,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, [{ op: 'split', ranges: ['1', '2'] }, ...stages])
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...options,
        documentNames: ['report10.docx', 'report2.docx'],
        ...split,
      }),
      null,
    )
  })

  it('requires a compose source after a built-in interval split, even with one input', () => {
    assert.match(
      pdfPipelineEditorError(JSON.stringify([compose()]), {
        ...options,
        splitMode: 'intervals',
        splitSpan: '1',
      }) ?? '',
      /needs a source after split/,
    )
  })

  it('rejects the incorrect lexicographic Office merge filename', async () => {
    const wrong = [...stages.slice(0, 2), compose('report10.docx_0.pdf')]
    const result = await forwarded({
      version: '9.10.0',
      names: ['report10.docx'],
      remotes: [remote],
      stages: wrong,
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /report2\.docx_0\.pdf/)
  })

  it('keeps the original filenames when selected ranges are unified', async () => {
    const split = { splitMode: 'pages', splitSpan: '1,2', splitUnify: true }
    const stages = [
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [{ source: 'report10.docx.pdf' }, { source: 'report2.docx.pdf' }],
      },
    ]
    const names = ['report10.docx', 'report2.docx']
    const result = await forwarded({ version: '9.10.0', names, split, stages })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, [{ op: 'select', pages: '1,2' }, ...stages])
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...options,
        documentNames: names,
        ...split,
      }),
      null,
    )
  })

  it('tracks numbered Office filenames after built-in merge and split', async () => {
    const names = ['report10.docx', 'report2.docx']
    const split = { splitMode: 'pages', splitSpan: '1,2' }
    const stages = [
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [{ source: 'report10.docx_0.pdf' }, { source: 'report10.docx_1.pdf' }],
      },
    ]
    const result = await forwarded({ version: '9.10.0', names, split, stages, merge: true })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.names, ['01_report10.docx', '02_report2.docx'])
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'split', ranges: ['1', '2'] },
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [{ source: '01_report10.docx_0.pdf' }, { source: '01_report10.docx_1.pdf' }],
      },
    ])
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...options,
        documentNames: names,
        builtInMerge: true,
        ...split,
      }),
      null,
    )
  })
})

describe('Merge bookmark mapping with incomplete or duplicate source names', () => {
  it.each(['pdf-pipeline', 'office-pdf'] as const)(
    'preserves exact labels for duplicate remote %s filenames',
    async (operation) => {
      const filename = operation === 'pdf-pipeline' ? 'report.pdf' : 'report.docx'
      const first = operation === 'pdf-pipeline' ? 'report.pdf' : 'report.docx.pdf'
      const second = operation === 'pdf-pipeline' ? 'report (2).pdf' : 'report (2).docx.pdf'
      const stages = [
        { op: 'merge', fileBookmarks: { labels: { [first]: 'First', [second]: 'Second' } } },
      ]
      const result = await forwarded({
        operation,
        version: '9.10.0',
        names: [],
        remotes: [
          { url: 'https://files.example.test/first', filename },
          { url: 'https://files.example.test/second', filename },
        ],
        stages,
      })
      assert.equal(result.status, 200, result.error)
      assert.deepEqual(result.stages, stages)
    },
  )

  it.each(['pdf-pipeline', 'office-pdf'] as const)(
    'maps known local %s split labels even with a dynamically named download',
    async (operation) => {
      const extension = operation === 'pdf-pipeline' ? 'pdf' : 'docx'
      const stem = operation === 'pdf-pipeline' ? 'report' : 'report.docx'
      const remotePart = operation === 'pdf-pipeline' ? 'remote_0.pdf' : 'remote.docx_0.pdf'
      const stages = [
        { op: 'split', ranges: ['1', '2'] },
        {
          op: 'merge',
          fileBookmarks: {
            labels: { [`${stem}_1.pdf`]: 'Local part', [remotePart]: 'Remote part' },
          },
        },
      ]
      const result = await forwarded({
        operation,
        version: '9.10.0',
        names: [`report.${extension}`, `other.${extension}`],
        remotes: [{ url: 'https://files.example.test/dynamic' }],
        stages,
      })
      assert.equal(result.status, 200, result.error)
      assert.deepEqual(result.names, [`01_report.${extension}`, `02_other.${extension}`])
      assert.deepEqual(result.stages, [
        stages[0],
        {
          op: 'merge',
          fileBookmarks: {
            labels: { [`01_${stem}_1.pdf`]: 'Local part', [remotePart]: 'Remote part' },
          },
        },
      ])
    },
  )

  it('accepts explicit split labels for numbered duplicate remote PDFs', async () => {
    const stages = [
      { op: 'split', ranges: ['1', '2'] },
      {
        op: 'merge',
        fileBookmarks: { labels: { 'report_0.pdf': 'First', 'report (2)_1.pdf': 'Second' } },
      },
    ]
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes: [
        { url: 'https://files.example.test/first', filename: 'report.pdf' },
        { url: 'https://files.example.test/second', filename: 'report.pdf' },
      ],
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, stages)
  })

  it('normalizes explicit labels even when a previous merge has an unknown output filename', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes: [{ url: 'https://files.example.test/dynamic' }],
      stages: [
        { op: 'merge' },
        { op: 'merge', fileBookmarks: { labels: { 'cafe\u0301.pdf': 'Cafe' } } },
      ],
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, [
      { op: 'merge' },
      { op: 'merge', fileBookmarks: { labels: { 'caf\u00e9.pdf': 'Cafe' } } },
    ])
  })

  it('still rejects separate explicit labels that normalize to the same filename', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes: [{ url: 'https://files.example.test/dynamic' }],
      stages: [
        { op: 'merge' },
        {
          op: 'merge',
          fileBookmarks: { labels: { 'cafe\u0301.pdf': 'First', 'caf\u00e9.pdf': 'Second' } },
        },
      ],
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /duplicate fileBookmarks label/)
  })
})

describe('Composition and bookmark preflight parity', () => {
  const editor = {
    localAssetNames: [],
    archivesPresent: false,
    remoteRows: [],
    remoteJson: '',
    acknowledgedRedaction: false,
    backendVersion: '9.10.0',
  }

  it.each(['pdf-pipeline', 'office-pdf'] as const)(
    'rejects a %s compose stage that omits a known source PDF',
    async (operation) => {
      const office = operation === 'office-pdf'
      const names = office ? ['report.docx', 'annex.docx'] : ['report.pdf', 'annex.pdf']
      const sources = office ? ['report.docx.pdf', 'annex.docx.pdf'] : names
      const stages = [compose(sources[0])]
      const result = await forwarded({ operation, version: '9.10.0', names, stages })
      assert.equal(result.status, 400, result.error)
      assert.equal(result.calls, 0)
      assert.match(result.error, /must place every PDF.*annex/)
      assert.match(
        pdfPipelineEditorError(JSON.stringify(stages), {
          ...editor,
          documentKind: office ? 'office' : 'pdf',
          documentNames: names,
        }) ?? '',
        /must place every PDF.*annex/,
      )
    },
  )

  it('rejects leading zeros in generated split part names', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['report.pdf'],
      stages: [{ op: 'split', ranges: ['1', '2'] }, compose('report_00.pdf')],
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /does not match a split output/)
  })

  it('rejects aliases for split part indices outside a fixed range list', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['report.pdf'],
      stages: [{ op: 'split', ranges: ['1', '2'] }, compose('report_2.pdf')],
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /does not match a split output/)
  })

  it('requires every output from a fixed range split, not merely every original PDF', async () => {
    const stages = [{ op: 'split', ranges: ['1', '2'] }, compose('report_0.pdf')]
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['report.pdf'],
      stages,
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /must place every PDF.*split output/)
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'pdf',
        documentNames: ['report.pdf'],
      }) ?? '',
      /must place every PDF.*split output/,
    )
  })

  it('accepts every nested fixed split part, including repeated placements of a page', async () => {
    const stages = [
      { op: 'split', ranges: ['1-2', '3-4'] },
      { op: 'split', ranges: ['1', '2'] },
      {
        op: 'compose',
        paperSize: 'A4',
        placements: [
          { source: 'report_0_0.pdf' },
          { source: 'report_0_1.pdf' },
          { source: 'report_1_0.pdf' },
          { source: 'report_1_1.pdf' },
          { source: 'report_1_1.pdf', page: 2 },
        ],
      },
    ]
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['report.pdf'],
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, stages)
    assert.equal(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'pdf',
        documentNames: ['report.pdf'],
      }),
      null,
    )
  })

  it('reports conflicting original and numbered bookmark aliases in the editor', () => {
    const stages = [
      {
        op: 'merge',
        fileBookmarks: { labels: { 'report.pdf': 'Original', '01_report.pdf': 'Numbered' } },
      },
    ]
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'pdf',
        documentNames: ['report.pdf', 'annex.pdf'],
      }) ?? '',
      /duplicate fileBookmarks label for 01_report\.pdf/,
    )
  })

  it('reports NFC-equivalent conflicting bookmark keys before resolving archive names', () => {
    const stages = [
      {
        op: 'merge',
        fileBookmarks: { labels: { 'cafe\u0301.pdf': 'Original', 'caf\u00e9.pdf': 'Normalized' } },
      },
    ]
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), {
        ...editor,
        documentKind: 'pdf',
        archivesPresent: true,
      }) ?? '',
      /duplicate fileBookmarks label for caf\u00e9\.pdf/,
    )
  })
})

describe('ambiguous backend numeric sorting', () => {
  const inputs = [
    { original: '01.pdf', forwarded: '01.pdf' },
    { original: '1.pdf', forwarded: '1.pdf' },
  ]
  const stages = [{ op: 'merge' }, { op: 'split', every: 1 }, compose('01_0.pdf')]

  it('cannot predict a merged filename when distinct numeric prefixes compare equally', () => {
    assert.throws(
      () => reconcilePdfComposeSources(parsePdfPipeline(JSON.stringify(stages)), { inputs }),
      /ambiguous.*filename|filename.*ambiguous/i,
    )
  })

  it('rejects ambiguous post-merge composition references in archived PDFs', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      archives: [zipFixture({ '01.pdf': '%PDF-1.7\n', '1.pdf': '%PDF-1.7\n' })],
      stages,
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /ambiguous.*filename|filename.*ambiguous/i)
  })

  it('reports ambiguous named remote sources in both the editor and proxy', async () => {
    const remotes = inputs.map(({ original }) => ({
      url: `https://files.example.test/${original}`,
      filename: original,
    }))
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes,
      stages,
    })
    assert.equal(result.status, 400, result.error)
    assert.equal(result.calls, 0)
    assert.match(result.error, /ambiguous.*filename|filename.*ambiguous/i)
    assert.match(
      pdfPipelineEditorError(JSON.stringify(stages), {
        documentKind: 'pdf',
        documentNames: [],
        localAssetNames: [],
        archivesPresent: false,
        remoteRows: [],
        remoteJson: JSON.stringify(remotes),
        acknowledgedRedaction: false,
        backendVersion: '9.10.0',
      }) ?? '',
      /ambiguous.*filename|filename.*ambiguous/i,
    )
  })

  it('cannot assign explicit split bookmark labels to an ambiguous merged filename', () => {
    assert.throws(
      () =>
        reconcilePdfComposeSources(
          parsePdfPipeline(
            JSON.stringify([
              { op: 'merge' },
              { op: 'split', every: 1 },
              { op: 'merge', fileBookmarks: { labels: { '01_0.pdf': 'First' } } },
            ]),
          ),
          { inputs, mapBookmarks: true },
        ),
      /ambiguous.*filename|filename.*ambiguous/i,
    )
  })

  it('keeps merges and composition without filename-dependent references valid', () => {
    for (const pipeline of [
      [{ op: 'merge' }],
      [{ op: 'merge' }, compose()],
      [{ op: 'merge' }, { op: 'split', every: 1 }],
      [{ op: 'compose', paperSize: 'A4', placements: [{ source: '01.pdf' }, { source: '1.pdf' }] }],
    ]) {
      assert.deepEqual(
        reconcilePdfComposeSources(parsePdfPipeline(JSON.stringify(pipeline)), { inputs }),
        pipeline,
      )
    }
  })

  it('retains a deterministic first filename when only later names compare equally', () => {
    const pipeline = [{ op: 'merge' }, { op: 'split', every: 1 }, compose('00_0.pdf')]
    assert.deepEqual(
      reconcilePdfComposeSources(parsePdfPipeline(JSON.stringify(pipeline)), {
        inputs: [...inputs, { original: '00.pdf', forwarded: '00.pdf' }],
      }),
      pipeline,
    )
  })
})

it('plans Chromium split names from the actual HTTP output header value', () => {
  const stages = [{ op: 'split', every: 1 }, compose('stable_0.pdf')]
  const operation = OPERATION_BY_ID.get('html-pdf')
  assert.ok(operation)
  const payload: ConversionPayload = {
    operation: 'html-pdf',
    fields: {},
    advanced: {},
    outputName: ' stable ',
    conversionStages: JSON.stringify(stages),
  }
  const form = adaptConversionForm(operation, payload, new FormData(), 9)
  assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
  assert.throws(
    () => adaptConversionForm(operation, { ...payload, outputName: '  ' }, new FormData(), 9),
    /Chromium output filename/,
  )
  assert.equal(
    pdfPipelineEditorError(JSON.stringify(stages), {
      localAssetNames: [],
      archivesPresent: false,
      remoteRows: [],
      remoteJson: '',
      acknowledgedRedaction: false,
      backendVersion: '9.10.0',
      documentKind: 'single',
      documentNames: [],
      outputName: ' stable ',
    }),
    null,
  )
})

describe('complete composition coverage and upload registration', () => {
  it.each(['pdf-pipeline', 'office-pdf'] as const)(
    'requires all duplicate %s split outputs',
    async (operation) => {
      const office = operation === 'office-pdf'
      const name = office ? 'same.docx' : 'same.pdf'
      const first = office ? 'same.docx_0.pdf' : 'same_0.pdf'
      const second = office ? 'same (2).docx_0.pdf' : 'same (2)_0.pdf'
      const options = {
        operation,
        version: '9.10.0',
        names: [name, name],
        stages: [{ op: 'split', ranges: ['1'] }, compose(second)],
      }
      const incomplete = await forwarded(options)
      assert.equal(incomplete.status, 400, incomplete.error)
      assert.match(incomplete.error, /place every PDF/)
      const complete = await forwarded({
        ...options,
        stages: [
          options.stages[0],
          { ...compose(), placements: [{ source: first }, { source: second }] },
        ],
      })
      assert.equal(complete.status, 200, complete.error)
    },
  )

  it('requires coverage of both input families even for an interval split', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['one.pdf', 'two.pdf'],
      stages: [{ op: 'split', every: 1 }, compose('one_0.pdf')],
    })
    assert.equal(result.status, 400, result.error)
    assert.match(result.error, /place every PDF/)
  })

  it('resolves a deterministic merge filename for duplicate pinned remote sources', async () => {
    const stages = [
      { op: 'merge' },
      { op: 'split', ranges: ['1', '2'] },
      { ...compose(), placements: [{ source: 'same_0.pdf' }, { source: 'same_1.pdf' }] },
    ]
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes: [
        { url: 'https://files.example.test/first', filename: 'same.pdf' },
        { url: 'https://files.example.test/second', filename: 'same.pdf' },
      ],
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, stages)
    const invalid = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: [],
      remotes: [
        { url: 'https://files.example.test/first', filename: 'same.pdf' },
        { url: 'https://files.example.test/second', filename: 'same.pdf' },
      ],
      stages: [stages[0], stages[1], compose('wrong_0.pdf')],
    })
    assert.equal(invalid.status, 400, invalid.error)
    assert.match(invalid.error, /does not match a split output/)
  })

  it('requires full coverage even if archive registration order is uncertain', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['same.pdf'],
      archives: [zipFixture({ 'same.pdf': '%PDF-1.7', 'same (2).pdf': '%PDF-1.7' })],
      stages: [
        { op: 'split', ranges: ['1'] },
        { ...compose(), placements: [{ source: 'same_0.pdf' }, { source: 'same (2)_0.pdf' }] },
      ],
    })
    assert.equal(result.status, 400, result.error)
    assert.match(result.error, /place every PDF/)
  })

  it('accepts multiple archive containers named like a source PDF', async () => {
    const result = await forwarded({
      operation: 'pdf-pipeline',
      version: '9.10.0',
      names: ['report.pdf'],
      archives: [
        new File([zipFixture({ 'one.pdf': '%PDF-1.7' })], 'report.pdf'),
        new File([zipFixture({ 'two.pdf': '%PDF-1.7' })], 'report.pdf'),
      ],
      stages: [{ op: 'merge' }],
    })
    assert.equal(result.status, 200, result.error)
    assert.equal(result.calls, 1)
  })

  it('rejects an incorrect explicit initial Chromium source when the output name is known', () => {
    const operation = OPERATION_BY_ID.get('html-pdf')
    assert.ok(operation)
    const payload: ConversionPayload = {
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      outputName: 'stable',
      conversionStages: JSON.stringify([compose('wrong.pdf')]),
    }
    assert.throws(
      () => adaptConversionForm(operation, payload, new FormData(), 9),
      /not one of the current PDF inputs/,
    )
    assert.match(
      pdfPipelineEditorError(payload.conversionStages ?? '', {
        localAssetNames: [],
        remoteRows: [],
        remoteJson: '',
        archivesPresent: false,
        acknowledgedRedaction: false,
        backendVersion: '9.10.0',
        documentKind: 'single',
        documentNames: [],
        outputName: 'stable',
      }) ?? '',
      /not one of the current PDF inputs/,
    )
  })
})

describe('composition coverage within each split branch', () => {
  it.each([
    ['skips the first interval part', [{ op: 'split', every: 1 }], ['report_1.pdf']],
    [
      'skips an interior interval part',
      [{ op: 'split', every: 1 }],
      ['report_0.pdf', 'report_2.pdf'],
    ],
    [
      'omits a fixed-range branch',
      [
        { op: 'split', ranges: ['1-2', '3-4'] },
        { op: 'split', every: 1 },
      ],
      ['report_0_0.pdf', 'report_0_1.pdf'],
    ],
    [
      'omits a nested fixed-range part',
      [
        { op: 'split', every: 2 },
        { op: 'split', ranges: ['1', '2'] },
      ],
      ['report_0_0.pdf', 'report_1_0.pdf', 'report_1_1.pdf'],
    ],
  ] as const)(
    'rejects a composition that %s in both editor and proxy',
    async (_description, splits, names) => {
      const stages = [...splits, { ...compose(), placements: names.map((source) => ({ source })) }]
      const result = await forwarded({
        operation: 'pdf-pipeline',
        names: ['report.pdf'],
        version: '9.10.0',
        stages,
      })
      assert.equal(result.status, 400, result.error)
      assert.equal(result.calls, 0)
      assert.match(result.error, /place every PDF/)
      assert.match(
        pdfPipelineEditorError(JSON.stringify(stages), {
          localAssetNames: [],
          archivesPresent: false,
          remoteRows: [],
          remoteJson: '',
          acknowledgedRedaction: false,
          backendVersion: '9.10.0',
          documentKind: 'pdf',
          documentNames: ['report.pdf'],
        }) ?? '',
        /place every PDF/,
      )
    },
  )

  it('accepts complete fixed branches with different interval counts and repeated placements', async () => {
    const stages = [
      { op: 'split', ranges: ['1-2', '3'] },
      { op: 'split', every: 1 },
      {
        ...compose(),
        placements: ['report_0_0.pdf', 'report_0_1.pdf', 'report_1_0.pdf', 'report_0_0.pdf'].map(
          (source) => ({ source }),
        ),
      },
    ]
    const result = await forwarded({
      operation: 'pdf-pipeline',
      names: ['report.pdf'],
      version: '9.10.0',
      stages,
    })
    assert.equal(result.status, 200, result.error)
    assert.deepEqual(result.stages, stages)
  })
})
