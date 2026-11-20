import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { validateFiles, validatePayload } from '#/lib/validation'
import { validateZipInputs } from '#/lib/zip-input-validation'
import { zipFixture } from './fixtures/zip'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', 'http://127.0.0.1:3000'))
afterEach(() => vi.unstubAllEnvs())

function proxyRequest(
  payload: Record<string, unknown>,
  assets: { archives?: File[]; auxiliary?: File[] } = {},
): Request {
  const form = new FormData()
  form.set('payload', JSON.stringify(payload))
  for (const file of assets.archives ?? []) form.append('archives', file)
  for (const file of assets.auxiliary ?? []) form.append('auxiliary', file)
  return new Request('https://gotenui.example.test/api/gotenberg/convert', {
    method: 'POST',
    headers: {
      Origin: 'https://gotenui.example.test',
      'X-Gotenberg-Url': 'http://127.0.0.1:3000',
    },
    body: form,
  })
}

function sourcePayload(
  operation: 'html-pdf' | 'markdown-pdf' | 'url-pdf' | 'html-shot',
  extra: Record<string, unknown> = {},
) {
  return validatePayload({
    operation,
    fields: operation === 'url-pdf' ? { url: 'https://example.test/' } : {},
    advanced: {},
    ...(operation === 'html-pdf' || operation === 'html-shot'
      ? { source: '<p>Local source</p>' }
      : operation === 'markdown-pdf'
        ? { source: '# Local source' }
        : {}),
    ...extra,
  })
}

test.each([
  ['html-pdf', 'index.html'],
  ['markdown-pdf', 'index.html'],
  ['markdown-pdf', 'document.md'],
] as const)('v9 rejects remote %s generated-source shadow %s', (id, name) => {
  for (const key of ['name', 'filename'] as const) {
    const { operation, payload } = sourcePayload(id, {
      downloadFrom: [{ url: 'https://assets.example.test/file', [key]: name }],
    })
    assert.throws(
      () => validateFiles(operation, [], [], 4_000_000, payload, {}, [], [], 9),
      /remote.*filename|shadow|collid/i,
    )
  }
})

test.each([
  ['html-pdf', 'https://assets.example.test/path/index.html?revision=2', 'index.html'],
  ['markdown-pdf', 'https://assets.example.test/document.md', 'document.md'],
  ['html-pdf', 'https://assets.example.test/path/another%2Findex.html', 'index.html'],
  ['html-pdf', 'https://assets.example.test/index%2Ehtml', 'index.html'],
] as const)('v9 rejects remote %s URL-inferred source shadow %s', (id, url, filename) => {
  const { operation, payload } = sourcePayload(id, { downloadFrom: [{ url }] })
  assert.throws(
    () => validateFiles(operation, [], [], 4_000_000, payload, {}, [], [], 9),
    /remote.*filename|shadow|collid/i,
    filename,
  )
})

test('an explicit remote filename takes precedence over an otherwise colliding URL', () => {
  const { operation, payload } = sourcePayload('html-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/index.html', filename: 'theme.css' }],
  })
  assert.doesNotThrow(() => validateFiles(operation, [], [], 4_000_000, payload, {}, [], [], 9))
})

test('v9 rejects remote files that shadow explicit local assets or generated headers', () => {
  const scenarios = [
    {
      operation: 'html-pdf' as const,
      extra: {},
      assets: [new File(['a'], 'theme.css')],
      name: 'theme.css',
    },
    {
      operation: 'url-pdf' as const,
      extra: { headerHtml: 'local header' },
      assets: [],
      name: 'header.html',
    },
    {
      operation: 'html-pdf' as const,
      extra: { footerHtml: 'local footer' },
      assets: [],
      name: 'footer.html',
    },
    {
      operation: 'markdown-pdf' as const,
      extra: { markdownFiles: [{ name: 'second.md', content: '# second' }] },
      assets: [],
      name: 'second.md',
    },
  ]
  for (const scenario of scenarios) {
    const { operation, payload } = sourcePayload(scenario.operation, {
      ...scenario.extra,
      downloadFrom: [{ url: 'https://assets.example.test/file', filename: scenario.name }],
    })
    assert.throws(
      () => validateFiles(operation, [], scenario.assets, 4_000_000, payload, {}, [], [], 9),
      /remote.*filename|shadow|collid/i,
      `${scenario.operation}: ${scenario.name}`,
    )
  }
})

test('v9 permits an uploaded HTML header or footer when no generated template exists', () => {
  const { operation, payload } = sourcePayload('html-pdf')
  const headers = [new File(['<header>From uploaded file</header>'], 'header.html')]
  assert.doesNotThrow(() =>
    validateFiles(operation, [], headers, 4_000_000, payload, {}, [], [], 9),
  )
  const form = createGotenbergForm(operation, payload, [], headers, 4_000_000, {}, [], 9)
  assert.deepEqual(
    (form.getAll('files') as File[]).map((file) => file.name),
    ['index.html', 'header.html'],
  )
})

test('v9 accepts ZIP header/footer resources unless the app generates those same files', async () => {
  const entries = zipFixture({
    'header.html': '<p>Archive header</p>',
    'footer.html': '<p>Archive footer</p>',
  })
  for (const id of ['html-pdf', 'markdown-pdf', 'html-shot'] as const) {
    const { operation, payload } = sourcePayload(id)
    assert.deepEqual(await validateZipInputs(operation, payload, [], [], [], [entries]), [
      'header.html',
      'footer.html',
    ])
  }
  const { operation, payload } = sourcePayload('html-pdf', { headerHtml: 'generated header' })
  await assert.rejects(
    validateZipInputs(operation, payload, [], [], [], [entries]),
    /duplicate or reserved filename: header\.html/,
  )
})

test('v9 rejects ZIP asset names shadowed by remote inputs, but allows unrelated assets', async () => {
  const { operation, payload } = sourcePayload('html-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/theme', filename: 'theme.css' }],
  })
  await assert.rejects(
    validateZipInputs(operation, payload, [], [], [], [zipFixture({ 'theme.css': 'body {}' })]),
    /remote|shadow|collid/i,
  )
  assert.deepEqual(
    await validateZipInputs(
      operation,
      payload,
      [],
      [],
      [],
      [zipFixture({ 'other.css': 'body {}' })],
    ),
    ['other.css'],
  )
})

test('v9 rejects ZIP entries shadowed by URL-inferred remote filenames', async () => {
  const { operation, payload } = sourcePayload('html-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/resources/theme.css?version=1' }],
  })
  await assert.rejects(
    validateZipInputs(operation, payload, [], [], [], [zipFixture({ 'theme.css': 'body {}' })]),
    /remote|shadow|collid/i,
  )
})

test('proxy detects a remote source override before forwarding a conversion', async () => {
  let conversionCalls = 0
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/version')) return new Response('9.9.0')
    conversionCalls++
    throw new Error('Remote source shadowing must be rejected')
  }
  await assert.rejects(
    proxyConversionRequest(
      proxyRequest({
        operation: 'html-pdf',
        source: '<h1>Trusted uploaded document</h1>',
        fields: {},
        advanced: {},
        downloadFrom: [{ url: 'https://assets.example.test/index', filename: 'index.html' }],
      }),
      fetcher,
    ),
    /Remote filename collides with a local document or asset: index\.html/,
  )
  assert.equal(conversionCalls, 0)
})

test('proxy forwards archived header templates when the frontend generated none', async () => {
  let conversionCalls = 0
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/version')) return new Response('9.9.0')
    conversionCalls++
    assert.ok(init?.body instanceof FormData)
    assert.deepEqual(
      (init.body.getAll('files') as File[]).map((file) => file.name),
      ['index.html'],
    )
    assert.equal(init.body.getAll('archives').length, 1)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(
    proxyRequest(
      {
        operation: 'html-pdf',
        source: '<h1>Document</h1>',
        fields: {},
        advanced: {},
      },
      { archives: [zipFixture({ 'header.html': '<p>From archive</p>' })] },
    ),
    fetcher,
  )
  assert.equal(response.status, 200)
  assert.equal(conversionCalls, 1)
})

// Gotenberg gives a downloaded Content-Disposition filename priority over the
// URL basename. Unless the proxy pins the filename, the remote response can
// shadow index.html or a named stage resource after preflight has passed.
test.each([
  ['html-pdf', 'https://assets.example.test/assets/theme.css'],
  ['markdown-pdf', 'https://assets.example.test/assets/theme.css'],
  ['html-shot', 'https://assets.example.test/assets/theme.css'],
] as const)('v9.9 pins URL-derived Chromium download filenames for %s', (id, url) => {
  const { operation, payload } = sourcePayload(id, { downloadFrom: [{ url }] })
  const form = createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
    major: 9,
    minor: 9,
    patch: 0,
  })
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [{ url, filename: 'theme.css' }])
})

test('v9.9 cannot trust unknown remote Chromium filenames to avoid shadowing generated HTML', () => {
  const { operation, payload } = sourcePayload('html-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/download?id=123' }],
  })
  assert.throws(
    () =>
      createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
        major: 9,
        minor: 9,
        patch: 0,
      }),
    /filename.*remote|remote.*filename/i,
  )
})

test('v9.9 pins inferred names when Chromium has ZIP assets or generated headers', () => {
  const { operation, payload } = sourcePayload('url-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/asset.css' }],
    headerHtml: '<p>Header</p>',
  })
  const form = createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
    major: 9,
    minor: 9,
    patch: 0,
  })
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://assets.example.test/asset.css', filename: 'asset.css' },
  ])
})

test('v9.9 leaves URL screenshot remote names unchanged when no local file can be shadowed', () => {
  const { operation, payload } = sourcePayload('url-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/download?id=123' }],
  })
  const form = createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
    major: 9,
    minor: 9,
    patch: 0,
  })
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [
    { url: 'https://assets.example.test/download?id=123' },
  ])
})

test('v9.1 cannot protect locally generated Chromium filenames with a remote override', () => {
  const { operation, payload } = sourcePayload('html-pdf', {
    downloadFrom: [{ url: 'https://assets.example.test/theme.css', name: 'theme.css' }],
  })
  assert.throws(
    () =>
      createGotenbergForm(operation, payload, [], [], 4_000_000, {}, [], 9, {
        major: 9,
        minor: 1,
        patch: 0,
      }),
    /9\.2|remote.*filenames/i,
  )
})

test('Chromium rejects inferred remote collisions with named conversion stage assets', () => {
  const { operation, payload } = sourcePayload('url-pdf', {
    conversionStages: JSON.stringify([{ op: 'attach', file: 'contract.txt' }]),
    downloadFrom: [{ url: 'https://assets.example.test/contract.txt' }],
  })
  assert.throws(
    () =>
      validateFiles(
        operation,
        [],
        [],
        4_000_000,
        payload,
        {},
        [new File(['contract'], 'contract.txt')],
        [],
        9,
      ),
    /remote.*filename|shadow|collid/i,
  )
})

test('proxy pins Chromium remote filenames before sending the multipart request to Gotenberg', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/version')) return new Response('9.9.0')
    assert.ok(init?.body instanceof FormData)
    assert.deepEqual(JSON.parse(String(init.body.get('downloadFrom'))), [
      { url: 'https://assets.example.test/theme.css', filename: 'theme.css' },
    ])
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  const response = await proxyConversionRequest(
    proxyRequest({
      operation: 'html-pdf',
      source: '<h1>Local content</h1>',
      fields: {},
      advanced: {},
      downloadFrom: [{ url: 'https://assets.example.test/theme.css' }],
    }),
    fetcher,
  )
  assert.equal(response.status, 200)
})

test('proxy rejects unpredictable Chromium remote filenames before conversion', async () => {
  let conversionCalls = 0
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/version')) return new Response('9.9.0')
    conversionCalls++
    throw new Error('Conversion must not be called with an unpinned remote name')
  }
  await assert.rejects(
    proxyConversionRequest(
      proxyRequest({
        operation: 'html-pdf',
        source: '<h1>Local content</h1>',
        fields: {},
        advanced: {},
        downloadFrom: [{ url: 'https://assets.example.test/download?id=123' }],
      }),
      fetcher,
    ),
    /Specify a remote filename/,
  )
  assert.equal(conversionCalls, 0)
})
