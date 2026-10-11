import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OFFICE_ACCEPT, OFFICE_EXTENSIONS } from '#/lib/office-formats'
import {
  encodeOfficialField,
  parseIgnoredDomains,
  parseStatusCodes,
} from '#/lib/official-form-fields'
import { unavailableOperationReason, versionAtLeast } from '#/lib/operation-availability'
import {
  activeOperationFields,
  isFieldVisible,
  OPERATION_BY_ID,
  type Operation,
  operationDefaults,
} from '#/lib/operations'
import { validateFiles, validatePayload } from '#/lib/validation'

function operation(id: string): Operation {
  const found = OPERATION_BY_ID.get(id)
  assert.ok(found, `Unknown test operation ${id}`)
  return found
}

function request(id: string, extra: Record<string, string | boolean> = {}) {
  const spec = operation(id)
  return {
    operation: id,
    fields: {
      ...operationDefaults(spec),
      ...extra,
      ...(spec.input === 'url' ? { url: 'https://example.test' } : {}),
    },
    advanced: {},
    ...(['html', 'markdown'].includes(spec.input) ? { source: '<h1>Test</h1>' } : {}),
  }
}

const doc = (name: string, content = 'sample') => new File([content], name)
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })

test('Office file picker and proxy validation use the same extended upstream file types', () => {
  const spec = operation('office-pdf')
  assert.ok(OFFICE_EXTENSIONS.length > 100)
  assert.equal(new Set(OFFICE_EXTENSIONS).size, OFFICE_EXTENSIONS.length)
  for (const ext of [
    '.dotx',
    '.xltx',
    '.potx',
    '.ppsx',
    '.ppsm',
    '.fodt',
    '.fods',
    '.pub',
    '.psd',
  ]) {
    assert.ok(OFFICE_ACCEPT.split(',').includes(ext), `Missing ${ext} from picker`)
    assert.doesNotThrow(() => validateFiles(spec, [doc(`test${ext}`)], [], 1000))
  }
  assert.throws(() => validateFiles(spec, [doc('bad.exe')], [], 1000), /Unsupported Office/)
})

test('PDF image optimization is a typed native control across supported routes', () => {
  for (const id of ['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf', 'merge', 'split']) {
    const spec = operation(id)
    assert.ok(
      spec.fields.some(({ name }) => name === 'optimizeImages'),
      id,
    )
    assert.ok(
      spec.fields.some(({ name }) => name === 'imageQuality'),
      id,
    )
    const extra = {
      optimizeImages: true,
      imageQuality: '74',
      ...(id === 'split' ? { splitMode: 'intervals', splitSpan: '2' } : {}),
    }
    const validated = validatePayload(request(id, extra))
    const files =
      spec.input === 'office'
        ? [doc('document.docx')]
        : spec.input === 'pdf'
          ? id === 'merge'
            ? [pdf('a.pdf'), pdf('b.pdf')]
            : [pdf('a.pdf')]
          : []
    const form = createGotenbergForm(validated.operation, validated.payload, files, [])
    assert.equal(form.get('optimizeImages'), 'true', id)
    assert.equal(form.get('imageQuality'), '74', id)
    assert.throws(() => validatePayload(request(id, { ...extra, imageQuality: '101' })), /range/)
    assert.throws(() => validatePayload(request(id, { ...extra, imageQuality: '1.5' })), /range/)
  }
  for (const id of ['url-shot', 'html-shot', 'markdown-shot']) {
    assert.ok(!operation(id).fields.some(({ name }) => name === 'optimizeImages'))
    assert.throws(() => validatePayload(request(id, { optimizeImages: true })), /Unsupported field/)
  }
})

test('Office compression has separate controls from post-conversion image optimization', () => {
  const spec = operation('office-pdf')
  const fields = {
    losslessImageCompression: false,
    quality: '55',
    reduceImageResolution: true,
    maxImageResolution: '150',
    optimizeImages: true,
    imageQuality: '70',
  }
  const { payload } = validatePayload(request(spec.id, fields))
  const form = createGotenbergForm(spec, payload, [doc('presentation.pptx')], [])
  for (const [name, value] of Object.entries(fields)) assert.equal(form.get(name), String(value))
  assert.throws(
    () => validatePayload(request(spec.id, { ...fields, maxImageResolution: '200' })),
    /Invalid option/,
  )
  assert.throws(
    () => validatePayload(request(spec.id, { ...fields, losslessImageCompression: true })),
    /JPEG quality requires/,
  )
  assert.throws(
    () => validatePayload(request(spec.id, { ...fields, reduceImageResolution: false })),
    /Target resolution.*requires/,
  )
  const hidden = activeOperationFields(spec, {
    ...fields,
    losslessImageCompression: true,
    reduceImageResolution: false,
    optimizeImages: false,
  })
  assert.equal(hidden.quality, undefined)
  assert.equal(hidden.maxImageResolution, undefined)
  assert.equal(hidden.imageQuality, undefined)
  const quality = spec.fields.find(({ name }) => name === 'quality')
  assert.ok(quality)
  assert.equal(isFieldVisible(quality, {}), true)
})

test('Office merging preserves ordered uploads and permits repeated local filenames only when enabled', async () => {
  const spec = operation('office-pdf')
  const docs = [doc('z.docx', 'first'), doc('same.docx', 'second'), doc('same.docx', 'third')]
  const { payload } = validatePayload(request('office-pdf', { merge: true }))
  validateFiles(spec, docs, [], 1000, payload)
  const form = createGotenbergForm(spec, payload, docs, [])
  assert.equal(form.get('merge'), 'true')
  const files = form.getAll('files') as File[]
  assert.deepEqual(
    files.map(({ name }) => name),
    ['01_z.docx', '02_same.docx', '03_same.docx'],
  )
  assert.deepEqual(await Promise.all(files.map((file) => file.text())), [
    'first',
    'second',
    'third',
  ])
  assert.throws(() => validateFiles(spec, docs, [], 1000), /Duplicate filename/)
  assert.doesNotThrow(() => validateFiles(spec, docs.slice(0, 1), [], 1000, payload))
})

test('Office converts then splits with engine-specific ranges and interval validation', () => {
  const spec = operation('office-pdf')
  for (const [mode, span, unify] of [
    ['pages', '1-3,5', true],
    ['intervals', '2', false],
  ] as const) {
    const fields = { splitMode: mode, splitSpan: span, splitUnify: unify }
    const { payload } = validatePayload(request(spec.id, fields))
    const form = createGotenbergForm(spec, payload, [doc('example.docx')], [])
    assert.equal(form.get('splitMode'), mode)
    assert.equal(form.get('splitSpan'), span)
    assert.equal(form.get('splitUnify'), String(unify))
  }
  assert.throws(() => validatePayload(request(spec.id, { splitMode: 'pages' })), /required/)
  assert.throws(
    () => validatePayload(request(spec.id, { splitMode: 'intervals', splitSpan: '0' })),
    /positive whole number/,
  )
  assert.throws(
    () =>
      validatePayload(
        request(spec.id, { splitMode: 'intervals', splitSpan: '3', splitUnify: true }),
      ),
    /only in pages mode|requires its related option/,
  )
  const filtered = activeOperationFields(spec, {
    splitMode: 'intervals',
    splitSpan: '3',
    splitUnify: true,
  })
  assert.equal(filtered.splitSpan, '3')
  assert.equal(filtered.splitUnify, undefined)
  // Don't reject valid engine-specific expressions at the proxy layer: Gotenberg selects the engine.
  assert.doesNotThrow(() =>
    validatePayload(request(spec.id, { splitMode: 'pages', splitSpan: '!1,2-5' })),
  )
})

test('Chromium reliability controls convert friendly strings to upstream JSON arrays', () => {
  const expectedFields = {
    failOnHttpStatusCodes: '499, 599',
    failOnResourceHttpStatusCodes: '404, 499, 599',
    ignoreResourceHttpStatusDomains: 'CDN.EXAMPLE.COM, *.analytics.example.com',
    failOnResourceLoadingFailed: true,
    failOnConsoleExceptions: true,
    skipNetworkIdleEvent: false,
    skipNetworkAlmostIdleEvent: false,
  }
  for (const id of [
    'url-pdf',
    'html-pdf',
    'markdown-pdf',
    'url-shot',
    'html-shot',
    'markdown-shot',
  ]) {
    const { payload, operation: spec } = validatePayload(request(id, expectedFields))
    const form = createGotenbergForm(spec, payload, [], [])
    assert.deepEqual(JSON.parse(String(form.get('failOnHttpStatusCodes'))), [499, 599])
    assert.deepEqual(JSON.parse(String(form.get('failOnResourceHttpStatusCodes'))), [404, 499, 599])
    assert.deepEqual(JSON.parse(String(form.get('ignoreResourceHttpStatusDomains'))), [
      'cdn.example.com',
      '*.analytics.example.com',
    ])
    assert.equal(form.get('failOnResourceLoadingFailed'), 'true')
    assert.equal(form.get('skipNetworkIdleEvent'), 'false')
    assert.equal(form.get('skipNetworkAlmostIdleEvent'), 'false')
  }
  assert.deepEqual(parseStatusCodes('404, 499, 404'), [404, 499])
  assert.deepEqual(parseIgnoredDomains('Example.com, example.com'), ['example.com'])
  assert.equal(encodeOfficialField(undefined, true), 'true')
  for (const invalid of ['abc', '99', '600', '404,', '400, 401, invalid']) {
    assert.throws(
      () => validatePayload(request('url-pdf', { failOnHttpStatusCodes: invalid })),
      /HTTP status/,
    )
  }
  for (const invalid of [
    'https://evil.test/path',
    'example.test/anything',
    'example.test:443',
    '.com',
  ]) {
    assert.throws(
      () =>
        validatePayload(
          request('url-shot', {
            failOnResourceHttpStatusCodes: '404',
            ignoreResourceHttpStatusDomains: invalid,
          }),
        ),
      /domain/,
    )
  }
  assert.throws(
    () => validatePayload(request('url-pdf', { ignoreResourceHttpStatusDomains: 'example.test' })),
    /requires its related option/,
  )
})

test('Gotenberg backend capability checks are conservative about unknown module details or versions', () => {
  const good = {
    online: true,
    version: '8.37.0',
    modules: [
      { name: 'chromium', status: 'up' },
      { name: 'libreoffice', status: 'up' },
    ],
  }
  assert.equal(unavailableOperationReason(good, operation('office-pdf')), null)
  assert.equal(unavailableOperationReason(good, operation('url-pdf')), null)
  assert.match(
    unavailableOperationReason(
      { ...good, modules: good.modules.slice(0, 1) },
      operation('office-pdf'),
    ) ?? '',
    /LibreOffice/,
  )
  assert.match(
    unavailableOperationReason({ ...good, modules: good.modules.slice(1) }, operation('url-pdf')) ??
      '',
    /Chromium/,
  )
  assert.equal(unavailableOperationReason({ ...good, modules: [] }, operation('office-pdf')), null)
  assert.equal(
    unavailableOperationReason({ ...good, online: false }, operation('office-pdf')),
    null,
  )
  assert.match(
    unavailableOperationReason({ ...good, version: '8.35.2' }, operation('optimize')) ?? '',
    /8\.36/,
  )
  assert.equal(
    unavailableOperationReason({ ...good, version: 'Unknown' }, operation('optimize')),
    null,
  )
  assert.equal(versionAtLeast('v8.36.0', 36), true)
  assert.equal(versionAtLeast('8.35.1', 36), false)
  assert.equal(versionAtLeast('9.0.0', 36), null)
})
