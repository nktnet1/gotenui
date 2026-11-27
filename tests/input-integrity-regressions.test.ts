import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { isAttachmentMimeType, parseAttachmentMetadata } from '#/lib/attachment-metadata'
import { BrowserBatchQueue } from '#/lib/browser-batch-queue'
import { normalizeAdvancedMediaFeatures } from '#/lib/chromium-media'
import { chromiumNetworkFields } from '#/lib/chromium-network'
import { convertWithGotenberg, createGotenbergForm } from '#/lib/gotenberg-client'
import { parseHttpEndpoint } from '#/lib/http-url'
import { parseIgnoredDomains } from '#/lib/official-form-fields'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { readPdfStructureResponse } from '#/lib/pdf-read-import'
import { metadataObject, validateBookmarkDocument } from '#/lib/pdf-structure-editors'
import { v9BookmarkTree } from '#/lib/pdf-v9-structure'
import { requireSameOrigin } from '#/lib/proxy-policy'
import { parseAdvanced, validatePayload } from '#/lib/validation'

const malformed = '\ud800'
const valid = 'R\u00e9sum\u00e9 \ud83d\ude00 \ufffd'

function request(
  operation: string,
  fields: Record<string, string | boolean> = {},
  extra: Record<string, unknown> = {},
) {
  const spec = OPERATION_BY_ID.get(operation)
  assert.ok(spec)
  return {
    operation,
    fields: {
      ...operationDefaults(spec),
      ...(spec.input === 'url' ? { url: 'https://example.test/' } : {}),
      ...fields,
    },
    advanced: {},
    ...extra,
  }
}

test('rejects malformed source text and passwords before multipart UTF-8 replacement', async () => {
  for (const candidate of [
    request('html-pdf', {}, { source: malformed }),
    request('html-pdf', {}, { source: valid, headerHtml: malformed }),
    request(
      'markdown-pdf',
      {},
      { source: valid, markdownFiles: [{ name: 'test.md', content: malformed }] },
    ),
    request('encrypt', { userPassword: malformed }),
    request('url-pdf', {}, { postProcess: { ownerPassword: malformed } }),
    request('url-pdf', {}, { advanced: { opaque: malformed } }),
  ]) {
    assert.throws(() => validatePayload(candidate), /malformed Unicode/)
  }
  const { operation, payload } = validatePayload(request('html-pdf', {}, { source: valid }))
  assert.equal(payload.source, valid)
  const [source] = createGotenbergForm(operation, payload, [], []).getAll('files')
  assert.ok(source instanceof File)
  assert.equal(await source.text(), valid)
  assert.equal(
    validatePayload(request('encrypt', { userPassword: valid })).payload.fields.userPassword,
    valid,
  )
})

test('rejects isolated surrogates in decoded Advanced JSON keys and values', () => {
  for (const candidate of [{ opaque: malformed }, { [malformed]: 'value' }]) {
    assert.throws(() => parseAdvanced(JSON.stringify(candidate)), /malformed Unicode/)
  }
  assert.deepEqual(parseAdvanced(JSON.stringify({ opaque: valid })), { opaque: valid })
})

test('rejects escaped malformed Unicode in metadata, bookmark and attachment structures', () => {
  const metadata = JSON.stringify({ Title: malformed })
  const bookmarks = JSON.stringify([{ title: malformed, page: 1 }])
  assert.throws(() => metadataObject(metadata), /malformed Unicode/)
  assert.throws(() => validateBookmarkDocument(bookmarks), /malformed Unicode/)
  assert.throws(() => v9BookmarkTree(bookmarks), /malformed Unicode/)
  assert.throws(() => validatePayload(request('merge', { bookmarks })), /malformed Unicode/)
  assert.equal(
    parseAttachmentMetadata(
      JSON.stringify({ 'a.txt': { mimeType: `text/plain;name="${malformed}"` } }),
    ),
    null,
  )
  assert.equal(isAttachmentMimeType(`text/plain;name="${malformed}"`), false)
  assert.deepEqual(metadataObject(JSON.stringify({ Title: valid })), { Title: valid })
  assert.doesNotThrow(() => validateBookmarkDocument(JSON.stringify([{ title: valid, page: 1 }])))
  assert.equal(isAttachmentMimeType(`text/plain;name="${valid}"`), true)
})

test('rejects malformed Unicode in known nested JSON fields and PDF stages', () => {
  const stages = [{ op: 'stamp-text', text: malformed, x: 12, y: 24 }]
  assert.throws(() => parsePdfPipeline(JSON.stringify(stages)), /malformed Unicode/)
  assert.throws(
    () => validatePayload(request('pdf-pipeline', { stages: JSON.stringify(stages) })),
    /malformed Unicode/,
  )
  assert.throws(
    () => normalizeAdvancedMediaFeatures(JSON.stringify({ [malformed]: valid })),
    /invalid Chromium media feature/,
  )
  assert.throws(
    () => normalizeAdvancedMediaFeatures(JSON.stringify({ feature: malformed })),
    /invalid Chromium media feature/,
  )
  const good = [{ ...stages[0], text: valid }]
  assert.deepEqual(parsePdfPipeline(JSON.stringify(good)), good)
})

test('rejects malformed Unicode in post-processing overlay options', () => {
  const candidate = (text: string) =>
    request(
      'url-pdf',
      {},
      {
        postProcess: {
          watermark: {
            source: 'text',
            expression: 'DRAFT',
            options: JSON.stringify({ font: text }),
          },
        },
      },
    )
  assert.throws(
    () => validatePayload(candidate(malformed)),
    /watermark 1 options contains malformed Unicode/,
  )
  assert.doesNotThrow(() => validatePayload(candidate(valid)))
})

test('rejects valid UTF-8 JSON responses containing escaped malformed Unicode before import', async () => {
  for (const value of [{ Title: malformed }, { [malformed]: 'title' }]) {
    await assert.rejects(
      readPdfStructureResponse(new Blob([JSON.stringify(value)])),
      /malformed Unicode/,
    )
  }
  assert.deepEqual(await readPdfStructureResponse(new Blob([JSON.stringify({ Title: valid })])), {
    Title: valid,
  })
})

test.each([
  'https:///example.test',
  'https://example.test\\path',
  'https://@example.test',
  'https://%65xample.test',
  'example.test/%ZZ',
  'example.test/path/https://other.test',
  '*.https://example.test',
  '//example.test/%',
])('rejects malformed or credential-bearing asset exclusions: %s', (value) => {
  assert.throws(() => parseIgnoredDomains(value), /asset exclusion domains/)
})

test('preserves valid wildcard, port, relative-authority and non-HTTP exclusion forms', () => {
  const domains = [
    '*.example.test',
    '.example.test',
    'example.test:443/path',
    '//example.test/asset',
    'ftp://example.test/path',
    'https://example.test/a%20b?opaque=%',
  ]
  assert.deepEqual(parseIgnoredDomains(domains.join(', ')), domains)
})

test.each([
  'https://@example.test',
  'https://exam\tple.test',
  'https://example.test\\',
  'https://example.test ',
])('rejects repaired public origins: %s', (value) => {
  assert.equal(parseHttpEndpoint(value), undefined)
  assert.throws(
    () => requireSameOrigin(new Request('https://example.test/api'), value),
    /GOTENUI_PUBLIC_ORIGIN/,
  )
})

test('allows explicitly configured canonical public origins and IPv6 ports', () => {
  const origin = 'https://[::1]:8443'
  assert.doesNotThrow(() => requireSameOrigin(new Request(`${origin}/api`), `${origin}/`))
})

test('preserves cookie paths and normalises escaped SameSite keys and values before Go decoding', () => {
  const cookie = {
    name: 'session',
    value: 'opaque',
    domain: 'example.test',
    path: '/private ',
    secure: true,
    httpOnly: false,
    sameSite: 'Lax' as const,
  }
  const fields = chromiumNetworkFields([cookie], [])
  assert.equal(JSON.parse(fields.cookies)[0].path, cookie.path)
  const raw = JSON.stringify([cookie]).replace('"sameSite":"Lax"', '"same\\u0053ite":"\\u006cax"')
  const { payload, operation } = validatePayload(request('url-pdf', { cookies: raw }))
  assert.deepEqual(
    JSON.parse(String(createGotenbergForm(operation, payload, [], []).get('cookies'))),
    [cookie],
  )
  assert.throws(
    () =>
      validatePayload(
        request('url-pdf', chromiumNetworkFields([{ ...cookie, path: ' /private' }], [])),
      ),
    /cookie/i,
  )
})

test('uses pinned version constraints before direct uploads or batch enqueue', async () => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const executor = vi.fn()
  const queue = new BrowserBatchQueue(executor)
  const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
  const file = new File(['%PDF-1.7'], 'input.pdf')
  const candidate = request('merge', {}, { expectedBackendVersion: '8.36.0' })
  try {
    await assert.rejects(
      convertWithGotenberg(connection, candidate, [file], [], new AbortController().signal),
      /at least 2 input files/,
    )
    assert.throws(
      () => queue.enqueue({ candidate, connection, files: [file], auxiliary: [], postFiles: {} }),
      /at least 2 input files/,
    )
    assert.equal(fetcher.mock.calls.length, 0)
    assert.equal(queue.getSnapshot().jobs.length, 0)
    assert.doesNotThrow(() =>
      queue.enqueue({
        candidate: { ...candidate, expectedBackendVersion: '9.10.2' },
        connection,
        files: [file],
        auxiliary: [],
        postFiles: {},
      }),
    )
    assert.throws(
      () =>
        queue.enqueue({
          candidate,
          connection,
          files: [],
          auxiliary: [],
          archives: [new File(['archive'], 'input.zip')],
          postFiles: {},
        }),
      /ZIP archive inputs require Gotenberg 9/,
    )
    assert.equal(executor.mock.calls.length, 0)
  } finally {
    queue.dispose()
    vi.unstubAllGlobals()
  }
})

test('rejects legacy embed uploads locally only when the pinned backend is Gotenberg 9', () => {
  const queue = new BrowserBatchQueue(vi.fn())
  const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
  const input = (expectedBackendVersion: string) => ({
    connection,
    candidate: request('url-pdf', {}, { expectedBackendVersion }),
    files: [],
    auxiliary: [],
    postFiles: { embeds: [new File(['proof'], 'proof.txt')] },
  })
  try {
    assert.throws(() => queue.enqueue(input('9.10.2')), /does not accept the legacy embeds field/)
    assert.doesNotThrow(() => queue.enqueue(input('8.36.0')))
  } finally {
    queue.dispose()
  }
})

test('rejects invalid conversion stage definitions during batch enqueue', () => {
  const queue = new BrowserBatchQueue(vi.fn())
  try {
    const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
    for (const stages of [
      'not JSON',
      JSON.stringify([{ op: 'stamp-text', text: malformed, x: 12, y: 24 }]),
    ]) {
      assert.throws(
        () =>
          queue.enqueue({
            connection,
            candidate: request('url-pdf', {}, { conversionStages: stages }),
            files: [],
            auxiliary: [],
            postFiles: {},
          }),
        /valid JSON|malformed Unicode/,
      )
    }
    assert.equal(queue.getSnapshot().jobs.length, 0)
  } finally {
    queue.dispose()
  }
})

test('validates all own form field names rather than dropping prototype-related names', () => {
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    const candidate = request('url-pdf')
    assert.throws(
      () => validatePayload({ ...candidate, fields: { ...candidate.fields, [name]: 'value' } }),
      /Unsupported field/,
    )
    assert.throws(() => parseAdvanced(JSON.stringify({ [name]: {} })), /Advanced values/)
    assert.deepEqual(parseAdvanced(JSON.stringify({ [name]: 'value' })), { [name]: 'value' })
  }
  assert.throws(
    () => validatePayload(request('url-pdf', {}, { advanced: { ['__proto__']: 'value' } })),
    /Unsupported advanced field/,
  )
})

test('keeps prototype-related HTTP header names and validates their actual values', () => {
  const headers = JSON.parse('{"__proto__":"safe","constructor":"other","prototype":"value"}')
  const remote = { url: 'https://example.test/input.pdf', extraHttpHeaders: headers }
  const webhook = { url: 'https://example.test/success', extraHttpHeaders: headers }
  const { payload, operation } = validatePayload(
    request('url-pdf', {}, { downloadFrom: [remote], webhook }),
  )
  for (const map of [
    payload.downloadFrom?.[0]?.extraHttpHeaders,
    payload.webhook?.extraHttpHeaders,
  ]) {
    assert.deepEqual(map, headers)
    assert.equal(Object.getPrototypeOf(map), Object.prototype)
    assert.equal(Object.getOwnPropertyDescriptor(map, '__proto__')?.value, 'safe')
  }
  const forwarded = createGotenbergForm(operation, payload, [], [])
  assert.deepEqual(JSON.parse(String(forwarded.get('downloadFrom')))[0].extraHttpHeaders, headers)
  assert.throws(
    () =>
      validatePayload(
        request(
          'url-pdf',
          {},
          {
            webhook: {
              ...webhook,
              extraHttpHeaders: { ...headers, ['__proto__']: 'bad\r\nvalue' },
            },
          },
        ),
      ),
    /Invalid extra HTTP header/,
  )
  assert.throws(
    () =>
      validatePayload(
        request(
          'url-pdf',
          {},
          { downloadFrom: [{ ...remote, extraHttpHeaders: { ...headers, constructor: 123 } }] },
        ),
      ),
    /Invalid/,
  )
})

test.each(['mediaColorScheme', 'mediaReducedMotion', 'mediaColorGamut', 'mediaForcedColors'])(
  'does not silently discard UI-only Advanced JSON media field %s on non-Chromium routes',
  (name) => {
    assert.throws(
      () => validatePayload(request('merge', {}, { advanced: { [name]: 'value' } })),
      /Unsupported advanced field/,
    )
  },
)

const stageCases = [
  ['9.0.9', '9.1.0', { op: 'extract-text' }, /9\.1 or newer/],
  [
    '9.1.9',
    '9.2.0',
    { op: 'compose', paperSize: 'A4', placements: [{ sourcePage: 1 }] },
    /9\.2 or newer/,
  ],
  ['9.1.9', '9.2.0', { op: 'select', pages: 'odd,!1' }, /9\.2 or newer/],
  ['9.3.9', '9.4.0', { op: 'stamp-text', text: 'Test', position: 'center' }, /9\.4 or newer/],
  [
    '9.4.9',
    '9.5.0',
    { op: 'compose', paperSize: 'A0', placements: [{ sourcePage: 1 }] },
    /9\.5 or newer/,
  ],
  ['9.5.9', '9.6.0', { op: 'optimize', dropSignatures: true }, /9\.6 or newer/],
  ['9.6.9', '9.7.0', { op: 'merge', fileBookmarks: { label: ['filename'] } }, /9\.7 or newer/],
  ['9.7.9', '9.8.0', { op: 'extract-text', format: 'text' }, /9\.8 or newer/],
  ['9.8.9', '9.9.0', { op: 'optimize', compressStreams: false }, /9\.9 or newer/],
] as const

test.each(stageCases)(
  'rejects stage version mismatch %s before transport or enqueue (supported from %s)',
  async (oldVersion, newVersion, stage, reason) => {
    const executor = vi.fn()
    const queue = new BrowserBatchQueue(executor)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
    const file = new File(['%PDF-1.7'], 'input.pdf')
    try {
      for (const conversion of [false, true]) {
        const stages = JSON.stringify([stage])
        const candidate = conversion
          ? request('url-pdf', {}, { expectedBackendVersion: oldVersion, conversionStages: stages })
          : request('pdf-pipeline', { stages }, { expectedBackendVersion: oldVersion })
        const files = conversion ? [] : [file]
        const input = { connection, candidate, files, auxiliary: [], postFiles: {} }
        await assert.rejects(
          convertWithGotenberg(connection, candidate, files, [], new AbortController().signal),
          reason,
        )
        assert.throws(() => queue.enqueue(input), reason)
        assert.doesNotThrow(() =>
          queue.enqueue({
            ...input,
            candidate: { ...candidate, expectedBackendVersion: newVersion },
          }),
        )
      }
      assert.equal(fetcher.mock.calls.length, 0)
      assert.equal(executor.mock.calls.length, 0)
      assert.equal(queue.getSnapshot().jobs.length, 2)
    } finally {
      queue.dispose()
      vi.unstubAllGlobals()
    }
  },
)

test.each([
  ['extract-text', {}, { expectedBackendVersion: '8.40.0' }, /not available on Gotenberg 8/],
  ['extract-text', {}, { expectedBackendVersion: '9.0.1' }, /9\.1 or newer/],
  ['optimize', {}, { expectedBackendVersion: '8.35.9' }, /8\.36 or newer/],
  [
    'url-pdf',
    {},
    {
      expectedBackendVersion: '9.1.9',
      downloadFrom: [{ url: 'https://example.test/a', filename: 'file.pdf' }],
    },
    /filename overrides require Gotenberg 9\.2/,
  ],
  [
    'url-pdf',
    {},
    { expectedBackendVersion: '8.40.0', conversionStages: '[{"op":"optimize"}]' },
    /Conversion-time PDF pipeline stages require Gotenberg 9/,
  ],
  [
    'url-pdf',
    {},
    { expectedBackendVersion: '9.10.2', postProcess: { flatten: true } },
    /Legacy PDF post-processing requires Gotenberg 8/,
  ],
  [
    'url-pdf',
    {},
    { expectedBackendVersion: '9.10.2', webhook: { url: 'https://example.test/hook' } },
    /require an events callback URL/,
  ],
  ['url-pdf', { paperSize: 'A0' }, { expectedBackendVersion: '9.4.9' }, /9\.5 or newer/],
] as const)(
  'preflights the pinned %s route and outbound settings %j',
  async (id, fields, extra, reason) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const queue = new BrowserBatchQueue(vi.fn())
    const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
    const files = id === 'url-pdf' ? [] : [new File(['%PDF-1.7'], 'input.pdf')]
    const candidate = request(id, fields, extra)
    try {
      await assert.rejects(
        convertWithGotenberg(connection, candidate, files, [], new AbortController().signal),
        reason,
      )
      assert.throws(
        () => queue.enqueue({ connection, candidate, files, auxiliary: [], postFiles: {} }),
        reason,
      )
      assert.equal(fetcher.mock.calls.length, 0)
      assert.equal(queue.getSnapshot().jobs.length, 0)
    } finally {
      queue.dispose()
      vi.unstubAllGlobals()
    }
  },
)

test.each([
  [
    'office-pdf',
    { splitMode: 'intervals', splitSpan: '2', pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' },
    {},
    { pdfaMethod: 'auto' },
    /requires PDF remediation/,
  ],
  [
    'url-pdf',
    { pdfaProfile: 'PDF/A-2b' },
    { conversionStages: '[{"op":"remediate","profile":"PDF/A-2b"}]' },
    { pdfaProfile: '' },
    /Only one remediate stage/,
  ],
] as const)(
  'preflights generated %s stages as well as user stages',
  async (id, fields, extra, correction, reason) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const queue = new BrowserBatchQueue(vi.fn())
    const connection = { kind: 'browser' as const, url: 'http://localhost:3000' }
    const files = id === 'office-pdf' ? [new File(['document'], 'document.txt')] : []
    const options = { expectedBackendVersion: '9.10.2', ...extra }
    const candidate = request(id, fields, options)
    try {
      await assert.rejects(
        convertWithGotenberg(connection, candidate, files, [], new AbortController().signal),
        reason,
      )
      const input = { connection, candidate, files, auxiliary: [], postFiles: {} }
      assert.throws(() => queue.enqueue(input), reason)
      assert.equal(fetcher.mock.calls.length, 0)
      assert.equal(queue.getSnapshot().jobs.length, 0)
      assert.doesNotThrow(() =>
        queue.enqueue({ ...input, candidate: request(id, { ...fields, ...correction }, options) }),
      )
    } finally {
      queue.dispose()
      vi.unstubAllGlobals()
    }
  },
)

test('rejects unknown conversion payload and Markdown source properties instead of discarding them', () => {
  assert.throws(() => validatePayload(request('url-pdf', {}, { expectedBackendVerison: '9.10.2' })))
  assert.throws(() =>
    validatePayload(
      request(
        'markdown-pdf',
        {},
        {
          markdownFiles: [{ name: 'chapter.md', content: '# Chapter', encoding: 'utf-8' }],
        },
      ),
    ),
  )
  assert.doesNotThrow(() =>
    validatePayload(
      request(
        'markdown-pdf',
        {},
        {
          markdownFiles: [{ name: 'chapter.md', content: '# Chapter' }],
        },
      ),
    ),
  )
})

test('rejects text sources for operations that would discard them', () => {
  for (const operation of ['url-pdf', 'office-pdf', 'merge']) {
    assert.throws(
      () => validatePayload(request(operation, {}, { source: 'document' })),
      /Source text requires/,
    )
  }
  for (const operation of ['html-pdf', 'markdown-pdf']) {
    assert.equal(validatePayload(request(operation, {}, { source: '' })).payload.source, '')
  }
})
