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
