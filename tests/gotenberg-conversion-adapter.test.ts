import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { adaptConversionForm } from '#/lib/gotenberg-conversion-adapter'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import type { ConversionPayload } from '#/lib/validation'
import { fieldSupportsBackend } from '#/tools/registry'

function fixture(id: string, overrides: Partial<ConversionPayload> = {}) {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation)
  const payload: ConversionPayload = {
    operation: id,
    fields: { ...operationDefaults(operation), ...overrides.fields },
    advanced: overrides.advanced ?? {},
    ...overrides,
  }
  if (overrides.fields) payload.fields = { ...operationDefaults(operation), ...overrides.fields }
  const files =
    id === 'office-pdf'
      ? [new File(['Sample document'], 'document.txt', { type: 'text/plain' })]
      : []
  const form = createGotenbergForm(operation, payload, files, [])
  return { operation, payload, form }
}

function adapt(id: string, overrides: Partial<ConversionPayload>, major: 8 | 9) {
  const { operation, payload, form } = fixture(id, overrides)
  return adaptConversionForm(operation, payload, form, major)
}

test('v8 Chromium retains legacy fields, array media features and PDF post-processing', () => {
  const form = adapt(
    'html-pdf',
    {
      fields: {
        generateDocumentOutline: true,
        generateTaggedPdf: true,
        nativePageRanges: '1-3',
        mediaColorScheme: 'dark',
        pdfa: 'PDF/A-2b',
      },
      advanced: { waitWindowStatus: 'ready' },
      source: '<html><body>Hello</body></html>',
    },
    8,
  )
  assert.equal(form.get('generateDocumentOutline'), 'true')
  assert.equal(form.get('generateTaggedPdf'), 'true')
  assert.equal(form.get('nativePageRanges'), '1-3')
  assert.equal(form.get('waitWindowStatus'), 'ready')
  assert.equal(form.get('pdfa'), 'PDF/A-2b')
  assert.deepEqual(JSON.parse(String(form.get('emulatedMediaFeatures'))), [
    { name: 'prefers-color-scheme', value: 'dark' },
  ])
  assert.equal(form.get('stages'), null)
})

test('v9 Chromium maps native controls and JSON media features, then remediates PDF/A', () => {
  const form = adapt(
    'html-pdf',
    {
      fields: {
        generateDocumentOutline: true,
        generateTaggedPdf: true,
        nativePageRanges: '1-3',
        mediaColorScheme: 'dark',
        mediaReducedMotion: 'reduce',
        paperSize: 'A4',
        pdfa: 'PDF/A-2b',
        pdfua: true,
      },
      advanced: { waitWindowStatus: 'ready' },
      source: '<html><body>Hello</body></html>',
    },
    9,
  )
  assert.equal(form.get('nativeBookmarks'), 'true')
  assert.equal(form.get('nativeTaggedPdf'), 'true')
  assert.equal(form.get('nativePages'), '1-3')
  assert.equal(form.get('waitForWindowStatus'), 'ready')
  assert.equal(form.get('paperSize'), 'A4')
  assert.equal(form.get('generateTaggedPdf'), null)
  assert.equal(form.get('generateDocumentOutline'), null)
  assert.equal(form.get('nativePageRanges'), null)
  assert.equal(form.get('pdfa'), null)
  assert.equal(form.get('pdfua'), null)
  assert.deepEqual(JSON.parse(String(form.get('emulatedMediaFeatures'))), {
    'prefers-color-scheme': 'dark',
    'prefers-reduced-motion': 'reduce',
  })
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] },
  ])
})

test('v9 Chromium exposes extended PDF/A and PDF/UA remediation profiles', () => {
  const form = adapt(
    'html-pdf',
    { fields: { pdfaProfile: 'PDF/A-4f', pdfuaProfile: 'PDF/UA-2' } },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'remediate', profile: ['PDF/A-4f', 'PDF/UA-2'] },
  ])
  assert.equal(form.has('pdfaProfile'), false)
  assert.equal(form.has('pdfuaProfile'), false)
})

test('v9 rejects incompatible PDF/A and PDF/UA profiles rather than silently changing the target', () => {
  assert.throws(
    () => adapt('html-pdf', { fields: { pdfaProfile: 'PDF/A-2u', pdfuaProfile: 'PDF/UA-2' } }, 9),
    /cannot be combined/,
  )
  assert.throws(
    () => adapt('html-pdf', { fields: { pdfa: 'PDF/A-2b', pdfaProfile: 'PDF/A-3a' } }, 9),
    /either a v9 PDF\/A profile or a legacy/,
  )
})

test('v8 rejects v9 conversion profile controls while keeping legacy PDF/A and PDF/UA', () => {
  assert.throws(
    () => adapt('office-pdf', { fields: { pdfaProfile: 'PDF/A-2u' } }, 8),
    /profiles require Gotenberg 9/,
  )
  const form = adapt('office-pdf', { fields: { pdfa: 'PDF/A-2b', pdfua: true } }, 8)
  assert.equal(form.get('pdfa'), 'PDF/A-2b')
  assert.equal(form.get('pdfua'), 'true')
})

test('v9 Office uses native export for supported profiles and remediation otherwise', () => {
  const native = adapt('office-pdf', { fields: { pdfaProfile: 'PDF/A-2b' } }, 9)
  assert.equal(native.get('nativePdfa'), 'PDF/A-2b')
  assert.equal(native.has('stages'), false)

  const remediation = adapt('office-pdf', { fields: { pdfaProfile: 'PDF/A-3u' } }, 9)
  assert.equal(remediation.has('nativePdfa'), false)
  assert.deepEqual(JSON.parse(String(remediation.get('stages'))), [
    { op: 'remediate', profile: 'PDF/A-3u' },
  ])

  const forced = adapt(
    'office-pdf',
    { fields: { pdfaProfile: 'PDF/A-2b', pdfaMethod: 'remediate' } },
    9,
  )
  assert.equal(forced.has('nativePdfa'), false)
  assert.deepEqual(JSON.parse(String(forced.get('stages'))), [
    { op: 'remediate', profile: 'PDF/A-2b' },
  ])
  assert.throws(
    () => adapt('office-pdf', { fields: { pdfaProfile: 'PDF/A-4e', pdfaMethod: 'native' } }, 9),
    /requires PDF remediation/,
  )
})

test('v9 Office uploads ZIP archives using the archives field, never the files field', () => {
  const archive = new File(['PK\u0003\u0004'], 'sources.zip', { type: 'application/zip' })
  const { operation, payload, form } = fixture('office-pdf')
  const adapted = adaptConversionForm(operation, payload, form, 9, [], [archive])
  assert.equal((adapted.get('archives') as File).name, 'sources.zip')
  assert.deepEqual(
    adapted.getAll('files').map((file) => (file instanceof File ? file.name : '')),
    ['document.txt'],
  )
  assert.throws(
    () => adaptConversionForm(operation, payload, form, 8, [], [archive]),
    /require Gotenberg 9/,
  )
})

test('version-specific PDF profiles are visible only for the intended version and tool', () => {
  const office = OPERATION_BY_ID.get('office-pdf')
  const chromium = OPERATION_BY_ID.get('html-pdf')
  const standalone = OPERATION_BY_ID.get('pdfa')
  assert.ok(office && chromium && standalone)
  for (const operation of [office, chromium]) {
    const legacy = operation.fields.find(({ name }) => name === 'pdfa')
    const modern = operation.fields.find(({ name }) => name === 'pdfaProfile')
    assert.ok(legacy && modern)
    assert.equal(fieldSupportsBackend(legacy, '8.40.0'), true)
    assert.equal(fieldSupportsBackend(legacy, '9.0.0'), false)
    assert.equal(fieldSupportsBackend(modern, '8.40.0'), false)
    assert.equal(fieldSupportsBackend(modern, '9.0.0'), true)
  }
  const existing = standalone.fields.find(({ name }) => name === 'pdfa')
  assert.ok(existing)
  assert.equal(fieldSupportsBackend(existing, '8.40.0'), true)
  assert.equal(fieldSupportsBackend(existing, '9.0.0'), true)
})

test('v9 screenshots also convert emulated media features to the new JSON object', () => {
  const form = adapt(
    'url-shot',
    { fields: { url: 'https://example.test', mediaColorScheme: 'dark' } },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('emulatedMediaFeatures'))), {
    'prefers-color-scheme': 'dark',
  })
  assert.equal(form.get('stages'), null)
})

test('v8 LibreOffice retains viewer numbers, watermark encodings and v8 defaults', () => {
  const form = adapt(
    'office-pdf',
    {
      fields: {
        initialView: '1',
        magnification: '4',
        pageLayout: '3',
        nativeWatermarkText: 'DRAFT',
        nativeWatermarkColor: '#112233',
        nativeWatermarkRotateAngle: '45.5',
        pdfa: 'PDF/A-2b',
        pdfua: true,
        quality: '80',
      },
    },
    8,
  )
  assert.equal(form.get('exportBookmarks'), 'true')
  assert.equal(form.get('initialView'), '1')
  assert.equal(form.get('magnification'), '4')
  assert.equal(form.get('pageLayout'), '3')
  assert.equal(form.get('nativeWatermarkColor'), String(0x112233))
  assert.equal(form.get('nativeWatermarkRotateAngle'), '455')
  assert.equal(form.get('quality'), '80')
  assert.equal(form.get('pdfa'), 'PDF/A-2b')
  assert.equal(form.get('pdfua'), 'true')
})

test('v9 LibreOffice maps viewer enums, native compression, watermark units and output stages', () => {
  const form = adapt(
    'office-pdf',
    {
      fields: {
        nativePageRanges: '1-3',
        generateTaggedPdf: true,
        initialView: '1',
        magnification: '4',
        pageLayout: '3',
        nativeWatermarkText: 'DRAFT',
        nativeWatermarkColor: '#112233',
        nativeWatermarkFontHeight: '32',
        nativeWatermarkFontName: 'Helvetica',
        nativeWatermarkRotateAngle: '45.5',
        quality: '80',
        singlePageSheets: true,
        losslessImageCompression: true,
        reduceImageResolution: true,
        maxImageResolution: '150',
        merge: true,
        splitMode: 'pages',
        splitSpan: '1-2,4',
        splitUnify: true,
        pdfa: 'PDF/A-4',
        pdfua: true,
      },
    },
    9,
  )
  for (const oldName of [
    'exportBookmarks',
    'generateTaggedPdf',
    'nativePageRanges',
    'singlePageSheets',
    'nativeWatermarkFontHeight',
    'nativeWatermarkFontName',
    'nativeWatermarkRotateAngle',
    'quality',
    'losslessImageCompression',
    'reduceImageResolution',
    'maxImageResolution',
    'pdfa',
    'pdfua',
    'merge',
    'splitMode',
    'splitSpan',
    'splitUnify',
  ])
    assert.equal(form.get(oldName), null, oldName)
  assert.equal(form.get('nativeBookmarks'), 'true')
  assert.equal(form.get('nativeTaggedPdf'), 'true')
  assert.equal(form.get('nativePages'), '1-3')
  assert.equal(form.get('singlePage'), 'true')
  assert.equal(form.get('nativeQuality'), '80')
  assert.equal(form.get('nativeLosslessImageCompression'), 'true')
  assert.equal(form.get('nativeReduceImageResolution'), 'true')
  assert.equal(form.get('nativeMaxImageResolution'), '150')
  assert.equal(form.get('initialView'), 'outline')
  assert.equal(form.get('magnification'), 'zoom')
  assert.equal(form.get('pageLayout'), 'twoColumnRight')
  assert.equal(form.get('nativeWatermarkColor'), '#112233')
  assert.equal(form.get('nativeWatermarkFontSize'), '32')
  assert.equal(form.get('nativeWatermarkFont'), 'Helvetica')
  assert.equal(form.get('nativeWatermarkRotation'), '45.5')
  assert.equal(form.get('nativePdfa'), null)
  assert.equal(form.get('nativePdfua'), null)
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'merge' },
    { op: 'select', pages: '1-2,4' },
    { op: 'remediate', profile: ['PDF/A-4', 'PDF/UA-2'] },
  ])
})

test('v9 Office native PDF/A and PDF/UA and interval splitting retain the original intent', () => {
  const form = adapt(
    'office-pdf',
    {
      fields: { pdfa: 'PDF/A-2b', pdfua: true, splitMode: 'intervals', splitSpan: '2' },
    },
    9,
  )
  assert.equal(form.get('nativePdfa'), 'PDF/A-2b')
  assert.equal(form.get('nativePdfua'), 'PDF/UA-1')
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'split', every: 2 }])
})

test('v9 does not silently accept incompatible v8 options or unvalidated stages', () => {
  assert.throws(
    () => adapt('office-pdf', { fields: { firstPageOnLeft: true, pageLayout: '3' } }, 9),
    /First page on left/,
  )
  assert.throws(
    () => adapt('html-pdf', { fields: { optimizeImages: true } }, 9),
    /lossless PDF optimisation/,
  )
  assert.throws(() => adapt('html-pdf', { advanced: { stages: '[]' } }, 9), /pipeline editor/)
  assert.throws(() => adapt('html-pdf', { postProcess: { flatten: true } }, 9), /post-processing/)
  assert.throws(() => adapt('office-pdf', { fields: { paperSize: 'A4' } }, 8), /Gotenberg 9/)
})

test('v9 rejects v8-only remote attachment destinations instead of changing their meaning', () => {
  assert.throws(
    () =>
      adapt(
        'html-pdf',
        {
          downloadFrom: [{ url: 'https://example.test/attachment.pdf', field: 'embedded' }],
        },
        9,
      ),
    /remote downloads as ordinary files/,
  )
  assert.equal(
    adapt('office-pdf', { downloadFrom: [{ url: 'https://example.test/report.docx' }] }, 9).get(
      'downloadFrom',
    ),
    '[{"url":"https://example.test/report.docx"}]',
  )
})

test('v9 combines conversion stages before final PDF/A remediation and preserves the selected options', () => {
  const { operation, payload, form } = fixture('html-pdf', {
    source: '<html><body>New content</body></html>',
    fields: { pdfa: 'PDF/A-2b' },
    conversionStages: JSON.stringify([
      { op: 'stamp-text', text: 'APPROVED', x: 15, y: 20 },
      { op: 'set-metadata', title: 'Converted and processed' },
    ]),
  })
  const adapted = adaptConversionForm(operation, payload, form, 9)
  assert.deepEqual(JSON.parse(String(adapted.get('stages'))), [
    { op: 'stamp-text', text: 'APPROVED', x: 15, y: 20 },
    { op: 'set-metadata', title: 'Converted and processed' },
    { op: 'remediate', profile: 'PDF/A-2b' },
  ])
  assert.equal(adapted.get('pdfa'), null)
})

test('v9 Office conversion merges first, then runs custom stages and remediates conformance last', () => {
  const { operation, payload, form } = fixture('office-pdf', {
    fields: { merge: true, pdfa: 'PDF/A-2b', pdfua: true },
    conversionStages: '[{"op":"set-metadata","title":"Document bundle"}]',
  })
  const adapted = adaptConversionForm(operation, payload, form, 9)
  assert.equal(adapted.has('nativePdfa'), false)
  assert.equal(adapted.has('nativePdfua'), false)
  assert.deepEqual(JSON.parse(String(adapted.get('stages'))), [
    { op: 'merge' },
    { op: 'set-metadata', title: 'Document bundle' },
    { op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] },
  ])
})

test('v9 attaches named stage uploads to PDF conversions, without changing the source document', () => {
  const { operation, payload, form } = fixture('office-pdf', {
    conversionStages: '[{"op":"attach","file":"receipt.txt"}]',
  })
  const attachment = new File(['receipt bytes'], 'receipt.txt')
  const adapted = adaptConversionForm(operation, payload, form, 9, [attachment])
  assert.deepEqual(
    (adapted.getAll('files') as File[]).map(({ name }) => name),
    ['document.txt', 'receipt.txt'],
  )
  assert.equal(adapted.get('stages'), '[{"op":"attach","file":"receipt.txt"}]')
})

test('v8 rejects conversion-time stages rather than silently ignoring them', () => {
  const { operation, payload, form } = fixture('html-pdf', {
    source: '<html><body>Test</body></html>',
    conversionStages: '[{"op":"optimize"}]',
  })
  assert.throws(() => adaptConversionForm(operation, payload, form, 8), /require Gotenberg 9/)
})

test('v9 rejects invalid stage references and dangerous ordering before conversion', () => {
  const missing = fixture('office-pdf', {
    conversionStages: '[{"op":"attach","file":"missing.txt"}]',
  })
  assert.throws(
    () => adaptConversionForm(missing.operation, missing.payload, missing.form, 9),
    /upload an additional file named/,
  )
  const decrypt = fixture('office-pdf', {
    conversionStages: '[{"op":"decrypt","password":"secret"}]',
  })
  assert.throws(
    () => adaptConversionForm(decrypt.operation, decrypt.payload, decrypt.form, 9),
    /Decryption is only available/,
  )
  const render = fixture('html-pdf', {
    source: '<html><body>Test</body></html>',
    fields: { pdfa: 'PDF/A-2b' },
    conversionStages: '[{"op":"render","pages":"1","format":"png"}]',
  })
  assert.throws(
    () => adaptConversionForm(render.operation, render.payload, render.form, 9),
    /Rendering must be the last stage/,
  )
})

test('conversion stage files cannot be sent without a configured v9 pipeline', () => {
  const { operation, payload, form } = fixture('office-pdf')
  assert.throws(
    () => adaptConversionForm(operation, payload, form, 9, [new File(['x'], 'extra.txt')]),
    /require a configured pipeline/,
  )
})

test('v9 rejects uploaded conversion stage files that no stage references', () => {
  const { operation, payload, form } = fixture('office-pdf', {
    conversionStages: '[{"op":"optimize"}]',
  })
  assert.throws(
    () => adaptConversionForm(operation, payload, form, 9, [new File(['x'], 'unused.txt')]),
    /Unused conversion stage file/,
  )
})
