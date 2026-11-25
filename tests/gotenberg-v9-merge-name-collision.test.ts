import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { zipFixture } from './fixtures/zip'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

function officeRequest(
  options: {
    stages?: unknown[]
    stageFiles?: File[]
    archives?: File[]
    remotes?: { url: string; name?: string }[]
    sourceNames?: string[]
    merge?: boolean
  } = {},
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: 'office-pdf',
      fields: { merge: options.merge ?? true },
      advanced: {},
      ...(options.stages ? { conversionStages: JSON.stringify(options.stages) } : {}),
      ...(options.remotes ? { downloadFrom: options.remotes } : {}),
    }),
  )
  for (const filename of options.sourceNames ?? ['report.docx']) {
    body.append('files', new File(['Office document'], filename), filename)
  }
  for (const file of options.stageFiles ?? []) body.append('stageFile', file, file.name)
  for (const file of options.archives ?? []) body.append('archives', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

async function forwardedFiles(
  request: Request,
  version = '9.1.0',
  path = '/forms/libreoffice/convert',
): Promise<{ filenames: string[]; stages: unknown[]; remotes: unknown[] }> {
  const output = { filenames: [] as string[], stages: [] as unknown[], remotes: [] as unknown[] }
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    assert.equal(new URL(String(url)).pathname, path)
    assert.ok(init?.body instanceof FormData)
    output.filenames = init.body
      .getAll('files')
      .map((entry) => (entry instanceof File ? entry.name : ''))
    const raw = init.body.get('stages')
    output.stages = raw ? JSON.parse(String(raw)) : []
    output.remotes = JSON.parse(String(init.body.get('downloadFrom') ?? '[]'))
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(request, fetcher)
  assert.equal(response.status, 200)
  await response.body?.cancel()
  return output
}

test('Gotenberg 9 Office merge preserves a named stage asset when its name matches a generated source prefix', async () => {
  const stageName = '01_report.docx'
  const output = await forwardedFiles(
    officeRequest({
      stages: [{ op: 'attach', file: stageName }],
      stageFiles: [new File(['attachment'], stageName)],
    }),
  )
  assert.deepEqual(output.filenames, ['01__report.docx', stageName])
  assert.deepEqual(output.stages, [{ op: 'merge' }, { op: 'attach', file: stageName }])
})

test('Gotenberg 9 Office merge reserves ZIP input filenames before numbering local documents', async () => {
  const output = await forwardedFiles(
    officeRequest({ archives: [zipFixture({ '01_report.docx': 'archived source' })] }),
  )
  assert.deepEqual(output.filenames, ['01__report.docx'])
  assert.deepEqual(output.stages, [{ op: 'merge' }])
})

test('Gotenberg 9 Office merge reserves named remote assets without changing the stage reference', async () => {
  const stageName = '01_report.docx'
  const output = await forwardedFiles(
    officeRequest({
      stages: [{ op: 'attach', file: stageName }],
      remotes: [{ url: 'https://example.test/report', name: stageName }],
    }),
  )
  assert.deepEqual(output.filenames, ['01__report.docx'])
  assert.deepEqual(output.stages, [{ op: 'merge' }, { op: 'attach', file: stageName }])
})

test('Gotenberg 9 Office merge keeps existing numbering when no asset names conflict', async () => {
  const output = await forwardedFiles(officeRequest({ sourceNames: ['z.docx', 'a.docx'] }))
  assert.deepEqual(output.filenames, ['01_z.docx', '02_a.docx'])
  assert.deepEqual(output.stages, [{ op: 'merge' }])
})

test('Gotenberg 9.2 preserves upload order for an explicit Office merge stage', async () => {
  const output = await forwardedFiles(
    officeRequest({
      merge: false,
      sourceNames: ['z.docx', 'a.docx'],
      stages: [{ op: 'merge' }],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['01_z.docx', '02_a.docx'])
  assert.deepEqual(output.stages, [{ op: 'merge' }])
})

test('Gotenberg 9.2 omits the source after an explicit Office merge', async () => {
  const output = await forwardedFiles(
    officeRequest({
      merge: false,
      sourceNames: ['z.docx', 'a.docx'],
      stages: [
        { op: 'merge' },
        { op: 'compose', paperSize: 'A4', placements: [{ source: 'z.docx.pdf', x: 12 }] },
      ],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['01_z.docx', '02_a.docx'])
  assert.deepEqual(output.stages, [
    { op: 'merge' },
    { op: 'compose', paperSize: 'A4', placements: [{ x: 12 }] },
  ])
})

test('Gotenberg 9.2 omits the source after the Office Merge switch', async () => {
  const output = await forwardedFiles(
    officeRequest({
      sourceNames: ['z.docx', 'a.docx'],
      stages: [{ op: 'compose', paperSize: 'A4', placements: [{ source: 'z.docx.pdf', x: 12 }] }],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['01_z.docx', '02_a.docx'])
  assert.deepEqual(output.stages, [
    { op: 'merge' },
    { op: 'compose', paperSize: 'A4', placements: [{ x: 12 }] },
  ])
})

test('Gotenberg 9.2 composes merged Office PDFs even with a PDF stage asset', async () => {
  const overlay = new File(['%PDF-1.7\n'], 'overlay.pdf')
  const output = await forwardedFiles(
    officeRequest({
      merge: false,
      sourceNames: ['z.docx', 'a.docx'],
      stageFiles: [overlay],
      stages: [
        { op: 'merge' },
        { op: 'compose', paperSize: 'A4', placements: [{ source: 'z.docx.pdf' }] },
        { op: 'stamp-pdf', source: 'overlay.pdf', x: 0, y: 0 },
      ],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['01_z.docx', '02_a.docx', 'overlay.pdf'])
  assert.deepEqual(output.stages, [
    { op: 'merge' },
    { op: 'compose', paperSize: 'A4', placements: [{}] },
    { op: 'stamp-pdf', source: 'overlay.pdf', x: 0, y: 0 },
  ])
})

test('Gotenberg 9.2 keeps original Office PDF names when composing before merging', async () => {
  const placements = [{ source: 'z.docx.pdf' }, { source: 'a.docx.pdf' }]
  const output = await forwardedFiles(
    officeRequest({
      merge: false,
      sourceNames: ['z.docx', 'a.docx'],
      stages: [{ op: 'compose', paperSize: 'A4', placements }, { op: 'merge' }],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['z.docx', 'a.docx'])
  assert.deepEqual(output.stages, [{ op: 'compose', paperSize: 'A4', placements }, { op: 'merge' }])
})

test('Gotenberg 9.2 reserves stage asset names for an explicit Office merge', async () => {
  const stageName = '01_z.docx'
  const output = await forwardedFiles(
    officeRequest({
      merge: false,
      sourceNames: ['z.docx', 'a.docx'],
      stageFiles: [new File(['attachment'], stageName)],
      stages: [{ op: 'merge' }, { op: 'attach', file: stageName }],
    }),
    '9.2.0',
  )
  assert.deepEqual(output.filenames, ['01__z.docx', '02_a.docx', stageName])
  assert.deepEqual(output.stages, [{ op: 'merge' }, { op: 'attach', file: stageName }])
})

function pdfMergeRequest(
  options: {
    archives?: File[]
    remotes?: { url: string; name?: string }[]
    sourceNames?: string[]
    fields?: Record<string, string | boolean>
    pipeline?: boolean
  } = {},
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: options.pipeline ? 'pdf-pipeline' : 'merge',
      fields: options.fields ?? {},
      advanced: {},
      ...(options.remotes ? { downloadFrom: options.remotes } : {}),
    }),
  )
  for (const filename of options.sourceNames ?? ['report.pdf']) {
    body.append('files', new File(['%PDF-1.7\n'], filename), filename)
  }
  for (const archive of options.archives ?? []) body.append('archives', archive, archive.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

test('Gotenberg 9 PDF merge reserves archive entry names before numbering input PDFs', async () => {
  const output = await forwardedFiles(
    pdfMergeRequest({
      archives: [zipFixture({ '02_a.pdf': '%PDF-1.7\n' })],
      sourceNames: ['z.pdf', 'a.pdf'],
    }),
    '9.1.0',
    '/forms/pdf/pipe',
  )
  assert.deepEqual(output.filenames, ['01_z.pdf', '02__a.pdf'])
  assert.deepEqual(output.stages, [{ op: 'merge' }])
})

test('Gotenberg 9 PDF merge reserves remote source names without changing the URL mapping', async () => {
  const output = await forwardedFiles(
    pdfMergeRequest({ remotes: [{ url: 'https://example.test/extra', name: '01_report.pdf' }] }),
    '9.1.0',
    '/forms/pdf/pipe',
  )
  assert.deepEqual(output.filenames, ['01__report.pdf'])
  assert.deepEqual(output.stages, [{ op: 'merge' }])
})

test.each([false, true])(
  'Gotenberg 9.10 Office merge reserves an inferred remote filename (pipeline=%s)',
  async (pipeline) => {
    const url = 'https://example.test/01_z.docx'
    const output = await forwardedFiles(
      officeRequest({
        merge: !pipeline,
        stages: pipeline ? [{ op: 'merge' }] : undefined,
        sourceNames: ['z.docx', 'a.docx'],
        remotes: [{ url }],
      }),
      '9.10.0',
    )
    assert.deepEqual(output.remotes, [{ url, filename: '01_z.docx' }])
    assert.deepEqual(output.filenames, ['01__z.docx', '02_a.docx'])
  },
)

test.each([false, true])(
  'Gotenberg 9.10 merge preserves local and remote bookmark labels when a pinned URL name collides (pipeline=%s)',
  async (pipeline) => {
    const url = 'https://example.test/01_z.pdf'
    const labels = { 'z.pdf': 'Local document', '01_z.pdf': 'Remote document' }
    const output = await forwardedFiles(
      pdfMergeRequest({
        pipeline,
        sourceNames: ['z.pdf', 'a.pdf'],
        remotes: [{ url }],
        fields: pipeline
          ? { stages: JSON.stringify([{ op: 'merge', fileBookmarks: { labels } }]) }
          : { v9FileBookmarks: true, v9FileBookmarkLabels: JSON.stringify(labels) },
      }),
      '9.10.0',
      '/forms/pdf/pipe',
    )
    assert.deepEqual(output.remotes, [{ url, filename: '01_z.pdf' }])
    assert.deepEqual(output.filenames, ['01__z.pdf', '02_a.pdf'])
    assert.deepEqual(output.stages, [
      {
        op: 'merge',
        fileBookmarks: { labels: { '01__z.pdf': 'Local document', '01_z.pdf': 'Remote document' } },
      },
    ])
  },
)

test('Gotenberg 9.10 merge reserves numbered duplicate remote filenames', async () => {
  const url = 'https://example.test/01_report.pdf'
  const output = await forwardedFiles(
    pdfMergeRequest({ sourceNames: ['report (2).pdf'], remotes: [{ url }, { url }] }),
    '9.10.0',
    '/forms/pdf/pipe',
  )
  assert.deepEqual(output.remotes, [
    { url, filename: '01_report.pdf' },
    { url, filename: '01_report.pdf' },
  ])
  assert.deepEqual(output.filenames, ['01__report (2).pdf'])
})

test.each(['pdf', 'office'] as const)(
  'Gotenberg 9.10 pipeline keeps inferred %s remote bookmark labels separate from numbered local aliases',
  async (kind) => {
    const extension = kind === 'pdf' ? 'pdf' : 'docx'
    const name = `report.${extension}`
    const pdfName = kind === 'pdf' ? name : `${name}.pdf`
    const localPdfName = `01_${pdfName}`
    const url = `https://example.test/${name}`
    const stages = [
      {
        op: 'merge',
        fileBookmarks: { labels: { [pdfName]: 'Remote report', [localPdfName]: 'Local report' } },
      },
    ]
    const request =
      kind === 'pdf'
        ? pdfMergeRequest({
            pipeline: true,
            sourceNames: [name, 'annex.pdf'],
            remotes: [{ url }],
            fields: { stages: JSON.stringify(stages) },
          })
        : officeRequest({
            merge: false,
            sourceNames: [name, 'annex.docx'],
            remotes: [{ url }],
            stages,
          })
    const output = await forwardedFiles(
      request,
      '9.10.0',
      kind === 'pdf' ? '/forms/pdf/pipe' : '/forms/libreoffice/convert',
    )
    assert.deepEqual(output.remotes, [{ url, filename: name }])
    assert.deepEqual(output.stages, stages)
  },
)
