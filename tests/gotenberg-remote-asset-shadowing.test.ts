import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { validateFiles, validatePayload } from '#/lib/validation'
import { validateZipInputs } from '#/lib/zip-input-validation'
import { zipFixture } from './fixtures/zip'

const upstream = 'http://127.0.0.1:3000'
const origin = 'https://gotenui.example.test'
const latest = { major: 9, minor: 9, patch: 0 } as const
const inputPdf = new File(['%PDF-1.7\n'], 'document.pdf', { type: 'application/pdf' })
const inputOffice = new File(['Office document'], 'document.docx')
const attachment = new File(['local attachment'], 'attachment.txt')

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

function validated(operation: 'pdf-pipeline' | 'office-pdf', extra: Record<string, unknown>) {
  return validatePayload({
    operation,
    fields:
      operation === 'pdf-pipeline'
        ? { stages: JSON.stringify([{ op: 'attach', file: 'attachment.txt' }]) }
        : {},
    advanced: {},
    ...(operation === 'office-pdf'
      ? { conversionStages: JSON.stringify([{ op: 'attach', file: 'attachment.txt' }]) }
      : {}),
    ...extra,
  })
}

function proxyRequest(
  operation: 'pdf-pipeline' | 'office-pdf',
  remotes: { url: string; filename?: string }[],
  options: { archives?: File[]; stageFile?: File; auxiliary?: File } = {},
): Request {
  const payload = validated(operation, { downloadFrom: remotes })
  const form = new FormData()
  form.set('payload', JSON.stringify(payload.payload))
  form.append('files', operation === 'pdf-pipeline' ? inputPdf : inputOffice)
  if (options.auxiliary) form.append('auxiliary', options.auxiliary)
  if (options.stageFile) form.append('stageFile', options.stageFile)
  for (const archive of options.archives ?? []) form.append('archives', archive)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body: form,
  })
}

test('v9.9 pins a PDF pipeline remote filename before Gotenberg registers local stage assets', () => {
  const { operation, payload } = validated('pdf-pipeline', {
    downloadFrom: [{ url: 'https://cdn.example.test/remote.txt' }],
  })
  const form = createGotenbergForm(
    operation,
    payload,
    [inputPdf],
    [attachment],
    4_000_000,
    {},
    [],
    9,
    latest,
  )
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://cdn.example.test/remote.txt', filename: 'remote.txt' },
  ])
})

test('v9.9 pins Office remote filenames when conversion stages use local files', () => {
  const { operation, payload } = validated('office-pdf', {
    downloadFrom: [{ url: 'https://cdn.example.test/remote.txt' }],
  })
  const form = createGotenbergForm(
    operation,
    payload,
    [inputOffice],
    [],
    4_000_000,
    {},
    [],
    9,
    latest,
  )
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://cdn.example.test/remote.txt', filename: 'remote.txt' },
  ])
})

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'v9.9 refuses unknown %s remote filenames if a local asset can be shadowed',
  (id) => {
    const { operation, payload } = validated(id, {
      downloadFrom: [{ url: 'https://cdn.example.test/download?id=7' }],
    })
    assert.throws(
      () =>
        createGotenbergForm(
          operation,
          payload,
          [id === 'pdf-pipeline' ? inputPdf : inputOffice],
          id === 'pdf-pipeline' ? [attachment] : [],
          4_000_000,
          {},
          [],
          9,
          latest,
          id === 'office-pdf' ? [attachment] : [],
        ),
      /Specify a remote filename/,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'v9.9 rejects known %s remote filenames colliding with local stage assets',
  (id) => {
    const { operation, payload } = validated(id, {
      downloadFrom: [{ url: 'https://cdn.example.test/other.txt', filename: 'attachment.txt' }],
    })
    assert.throws(
      () =>
        validateFiles(
          operation,
          [id === 'pdf-pipeline' ? inputPdf : inputOffice],
          id === 'pdf-pipeline' ? [attachment] : [],
          4_000_000,
          payload,
          {},
          id === 'office-pdf' ? [attachment] : [],
          [],
          9,
        ),
      /Remote filename collides with a local document or asset/,
    )
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'v9.9 rejects remote files shadowing %s ZIP stage assets',
  async (id) => {
    const { operation, payload } = validated(id, {
      downloadFrom: [{ url: 'https://cdn.example.test/attachment.txt' }],
    })
    await assert.rejects(
      validateZipInputs(
        operation,
        payload,
        [id === 'pdf-pipeline' ? inputPdf : inputOffice],
        [],
        [],
        [zipFixture({ 'attachment.txt': 'local attachment' })],
      ),
      /filename collides with a remote asset/,
    )
  },
)

test('v9.1 preserves existing PDF remote download behavior without a filename override', () => {
  const { operation, payload } = validated('pdf-pipeline', {
    downloadFrom: [{ url: 'https://cdn.example.test/remote.pdf' }],
  })
  const form = createGotenbergForm(
    operation,
    payload,
    [inputPdf],
    [attachment],
    4_000_000,
    {},
    [],
    9,
    {
      major: 9,
      minor: 1,
      patch: 0,
    },
  )
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://cdn.example.test/remote.pdf' },
  ])
})

test('duplicate remote and local PDF source names remain permitted', () => {
  const { operation, payload } = validated('pdf-pipeline', {
    fields: { stages: JSON.stringify([{ op: 'optimize' }]) },
    downloadFrom: [{ url: 'https://cdn.example.test/document.pdf' }],
  })
  assert.doesNotThrow(() =>
    validateFiles(operation, [inputPdf], [], 4_000_000, payload, {}, [], [], 9),
  )
  const form = createGotenbergForm(operation, payload, [inputPdf], [], 4_000_000, {}, [], 9, latest)
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://cdn.example.test/document.pdf', filename: 'document.pdf' },
  ])
})

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'proxy pins %s remote names in the outgoing multipart request',
  async (id) => {
    let calls = 0
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/version')) return new Response('9.9.0')
      calls++
      assert.ok(init?.body instanceof FormData)
      assert.deepEqual(JSON.parse(String(init.body.get('downloadFrom'))), [
        { url: 'https://cdn.example.test/remote.txt', filename: 'remote.txt' },
      ])
      assert.equal(init.body.getAll('files').length, 2)
      return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
    }
    const response = await proxyConversionRequest(
      proxyRequest(
        id,
        [{ url: 'https://cdn.example.test/remote.txt' }],
        id === 'pdf-pipeline' ? { auxiliary: attachment } : { stageFile: attachment },
      ),
      fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(calls, 1)
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'v9.9 preserves a dynamic %s remote URL when only ordinary source files are local',
  (id) => {
    const { operation, payload } = validated(id, {
      ...(id === 'pdf-pipeline'
        ? { fields: { stages: JSON.stringify([{ op: 'optimize' }]) } }
        : { conversionStages: undefined }),
      downloadFrom: [{ url: 'https://cdn.example.test/download?id=7' }],
    })
    const form = createGotenbergForm(
      operation,
      payload,
      [id === 'pdf-pipeline' ? inputPdf : inputOffice],
      [],
      4_000_000,
      {},
      [],
      9,
      latest,
    )
    assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
      { url: 'https://cdn.example.test/download?id=7' },
    ])
  },
)

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'v9.9 permits numbered %s ZIP source duplicates from remote downloads',
  async (id) => {
    const { operation, payload } = validated(id, {
      ...(id === 'pdf-pipeline'
        ? { fields: { stages: JSON.stringify([{ op: 'merge' }]) } }
        : { conversionStages: undefined }),
      downloadFrom: [
        {
          url: 'https://cdn.example.test/document',
          filename: id === 'pdf-pipeline' ? 'document.pdf' : 'document.docx',
        },
      ],
    })
    const filename = id === 'pdf-pipeline' ? 'document.pdf' : 'document.docx'
    assert.deepEqual(
      await validateZipInputs(
        operation,
        payload,
        [],
        [],
        [],
        [zipFixture({ [filename]: id === 'pdf-pipeline' ? '%PDF-1.7\n' : 'Office' })],
      ),
      [filename],
    )
  },
)

test('v9.9 preserves a dynamically named remote PDF alongside ZIP source PDFs', () => {
  const { operation, payload } = validated('pdf-pipeline', {
    fields: { stages: JSON.stringify([{ op: 'merge' }]) },
    downloadFrom: [{ url: 'https://cdn.example.test/download?id=7' }],
  })
  const archive = zipFixture({ 'archive.pdf': '%PDF-1.7\n' })
  const form = createGotenbergForm(
    operation,
    payload,
    [],
    [],
    4_000_000,
    {},
    [archive],
    9,
    latest,
    [],
    ['archive.pdf'],
  )
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://cdn.example.test/download?id=7' },
  ])
})

test('v9.9 requires stable names when a remote could shadow a ZIP stage asset', () => {
  const { operation, payload } = validated('pdf-pipeline', {
    downloadFrom: [{ url: 'https://cdn.example.test/download?id=7' }],
  })
  const archive = zipFixture({ 'attachment.txt': 'local attachment' })
  assert.throws(
    () =>
      createGotenbergForm(
        operation,
        payload,
        [inputPdf],
        [],
        4_000_000,
        {},
        [archive],
        9,
        latest,
        [],
        ['attachment.txt'],
      ),
    /Specify a remote filename/,
  )
})

test.each(['pdf-pipeline', 'office-pdf'] as const)(
  'rejects auto-numbered remote downloads that shadow %s local assets',
  async (id) => {
    const local = new File(['local attachment'], 'attachment (2).txt')
    const url = 'https://cdn.example.test/attachment.txt'
    const { operation, payload } = validated(id, {
      downloadFrom: [{ url }, { url }],
      ...(id === 'pdf-pipeline'
        ? { fields: { stages: JSON.stringify([{ op: 'attach', file: local.name }]) } }
        : { conversionStages: JSON.stringify([{ op: 'attach', file: local.name }]) }),
    })
    const files = [id === 'pdf-pipeline' ? inputPdf : inputOffice]
    assert.throws(
      () =>
        validateFiles(
          operation,
          files,
          id === 'pdf-pipeline' ? [local] : [],
          4_000_000,
          payload,
          {},
          id === 'office-pdf' ? [local] : [],
          [],
          9,
        ),
      /Remote filename collides with a local document or asset: attachment \(2\)\.txt/,
    )
    await assert.rejects(
      validateZipInputs(
        operation,
        payload,
        files,
        [],
        [],
        [zipFixture({ [local.name]: 'local attachment' })],
      ),
      /filename collides with a remote asset: attachment \(2\)\.txt/,
    )
  },
)

function pipelineRequest(
  files: File[],
  asset: string,
  options: {
    auxiliary?: File[]
    archives?: File[]
    remotes?: { url: string; filename?: string }[]
    merge?: boolean
  } = {},
): Request {
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: 'pdf-pipeline',
      fields: {
        stages: JSON.stringify([
          ...(options.merge ? [{ op: 'merge' }] : []),
          { op: 'attach', file: asset },
        ]),
      },
      advanced: {},
      downloadFrom: options.remotes,
    }),
  )
  for (const file of files) body.append('files', file)
  for (const file of options.auxiliary ?? []) body.append('auxiliary', file)
  for (const file of options.archives ?? []) body.append('archives', file)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

const duplicatePdf = new File(['%PDF-1.7 second\n'], 'document.pdf')
const numberedAsset = new File(['%PDF-1.7 asset\n'], 'document (2).pdf')

function versionOnlyFetcher(): typeof fetch {
  return async (url) => {
    if (String(url).endsWith('/version')) return new Response('9.10.0')
    assert.fail('Ambiguous stage assets must not reach Gotenberg.')
  }
}

test('rejects a local PDF stage asset shadowed by duplicate source uploads', async () => {
  await assert.rejects(
    proxyConversionRequest(
      pipelineRequest([inputPdf, duplicatePdf], numberedAsset.name, { auxiliary: [numberedAsset] }),
      versionOnlyFetcher(),
    ),
    /Stage asset filename collides after Gotenberg numbers duplicate files: document \(2\)\.pdf/,
  )
})

test('rejects a ZIP stage asset shadowed by duplicate uploads when files register before archives', async () => {
  await assert.rejects(
    proxyConversionRequest(
      pipelineRequest([inputPdf, duplicatePdf], numberedAsset.name, {
        archives: [zipFixture({ [numberedAsset.name]: '%PDF-1.7 asset\n' })],
      }),
      versionOnlyFetcher(),
    ),
    /Stage asset filename collides after Gotenberg numbers duplicate files: document \(2\)\.pdf/,
  )
})

test('rejects a local stage asset shadowed by duplicate ZIP entries when archives register first', async () => {
  await assert.rejects(
    proxyConversionRequest(
      pipelineRequest([inputPdf], numberedAsset.name, {
        auxiliary: [numberedAsset],
        archives: [
          zipFixture({
            'one/document.pdf': '%PDF-1.7 one\n',
            'two/document.pdf': '%PDF-1.7 two\n',
          }),
        ],
      }),
      versionOnlyFetcher(),
    ),
    /Stage asset filename collides after Gotenberg numbers duplicate files: document \(2\)\.pdf/,
  )
})

test('rejects a pinned remote stage asset shadowed by earlier duplicate downloads', async () => {
  const url = 'https://cdn.example.test/document.pdf'
  await assert.rejects(
    proxyConversionRequest(
      pipelineRequest([inputPdf], numberedAsset.name, {
        remotes: [
          { url, filename: inputPdf.name },
          { url, filename: inputPdf.name },
          { url, filename: numberedAsset.name },
        ],
      }),
      versionOnlyFetcher(),
    ),
    /Stage asset filename collides after Gotenberg numbers duplicate files: document \(2\)\.pdf/,
  )
})

test('allows the same local duplicates when a merge numbers them before registration', async () => {
  const response = await proxyConversionRequest(
    pipelineRequest([inputPdf, duplicatePdf], numberedAsset.name, {
      auxiliary: [numberedAsset],
      merge: true,
    }),
    async (url, init) => {
      if (String(url).endsWith('/version')) return new Response('9.10.0')
      assert.ok(init?.body instanceof FormData)
      assert.deepEqual(
        init.body.getAll('files').map((entry) => entry instanceof File && entry.name),
        ['01_document.pdf', '02_document.pdf', numberedAsset.name],
      )
      return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(response.status, 200)
  await response.body?.cancel()
})
