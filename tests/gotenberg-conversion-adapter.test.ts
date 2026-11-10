import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { adaptConversionForm } from '#/lib/gotenberg-conversion-adapter'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import type { ConversionPayload } from '#/lib/validation'
import { type FieldDefinition, fieldSupportsBackend } from '#/tools/registry'

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

test('v9 conversion stages omit empty optional PDF file references', () => {
  const stages = [{ op: 'remediate', profile: 'Factur-X', xml: '' }]
  const form = adapt(
    'html-pdf',
    {
      source: '<html><body>Invoice</body></html>',
      conversionStages: JSON.stringify(stages),
    },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
})

test('v9 Office conversion stages permit duplicate local and remote source names', () => {
  const url = 'https://example.test/document.txt'
  const form = adapt(
    'office-pdf',
    {
      downloadFrom: [{ url, name: 'document.txt' }],
      conversionStages: '[{"op":"rotate","angle":90}]',
    },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('downloadFrom'))), [{ url }])
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [{ op: 'rotate', angle: 90 }])
  assert.deepEqual(
    (form.getAll('files') as File[]).map((file) => file.name),
    ['document.txt'],
  )
})

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

test('v9 Chromium permits PDF/A-1b with PDF/UA-1, while v8 keeps the legacy restriction', () => {
  const options = { fields: { pdfa: 'PDF/A-1b', pdfua: true } }
  const v9 = adapt('html-pdf', options, 9)
  assert.deepEqual(JSON.parse(String(v9.get('stages'))), [
    { op: 'remediate', profile: ['PDF/A-1b', 'PDF/UA-1'] },
  ])
  assert.throws(() => adapt('html-pdf', options, 8), /cannot combine/)
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

test('v9 Office keeps native PDF/A export with a no-op conversion pipeline', () => {
  for (const conversionStages of ['[]', 'null', '  ']) {
    const form = adapt(
      'office-pdf',
      { fields: { pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' }, conversionStages },
      9,
    )
    assert.equal(form.get('nativePdfa'), 'PDF/A-2b')
    assert.equal(form.has('stages'), false)
  }
  assert.throws(
    () =>
      adapt(
        'office-pdf',
        {
          fields: { pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' },
          conversionStages: '[{"op":"optimize"}]',
        },
        9,
      ),
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

test('v9 conversion stages resolve named remote stamp and attachment assets', () => {
  const { operation, payload, form } = fixture('html-pdf', {
    downloadFrom: [
      { url: 'https://example.test/assets/stamp', name: 'badge.png' },
      { url: 'https://example.test/receipts/123', name: 'receipt.xml' },
    ],
    conversionStages: JSON.stringify([
      { op: 'stamp-image', image: 'badge.png', x: 10, y: 20 },
      { op: 'attach', file: 'receipt.xml' },
    ]),
  })
  const adapted = adaptConversionForm(operation, payload, form, 9)
  assert.equal(JSON.parse(String(adapted.get('stages'))).length, 2)
  assert.deepEqual(JSON.parse(String(adapted.get('downloadFrom'))), [
    { url: 'https://example.test/assets/stamp' },
    { url: 'https://example.test/receipts/123' },
  ])
  const conflicting = new File(['replacement'], 'badge.png')
  assert.throws(
    () =>
      adaptConversionForm(operation, payload, fixture('html-pdf', payload).form, 9, [conflicting]),
    /duplicates another file/,
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
  const modern = standalone.fields.find(({ name }) => name === 'pdfaProfile')
  assert.ok(existing && modern)
  assert.equal(fieldSupportsBackend(existing, '8.40.0'), true)
  assert.equal(fieldSupportsBackend(existing, '9.1.0'), false)
  assert.equal(fieldSupportsBackend(modern, '8.40.0'), false)
  assert.equal(fieldSupportsBackend(modern, '9.1.0'), true)
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

test('v9 Office ends interval splitting with remediation for both requested profiles', () => {
  const form = adapt(
    'office-pdf',
    {
      fields: { pdfa: 'PDF/A-2b', pdfua: true, splitMode: 'intervals', splitSpan: '2' },
    },
    9,
  )
  assert.equal(form.has('nativePdfa'), false)
  assert.equal(form.has('nativePdfua'), false)
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'split', every: 2 },
    { op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] },
  ])
})

const officeConformanceStages: {
  fields: Record<string, string | boolean>
  stages: { op: string; [name: string]: unknown }[]
}[] = [
  { fields: { merge: true }, stages: [{ op: 'merge' }] },
  {
    fields: { splitMode: 'pages', splitSpan: '1-3' },
    stages: [{ op: 'split', ranges: ['1-3'] }],
  },
  {
    fields: { splitMode: 'pages', splitSpan: '1-3', splitUnify: true },
    stages: [{ op: 'select', pages: '1-3' }],
  },
  {
    fields: { splitMode: 'intervals', splitSpan: '2' },
    stages: [{ op: 'split', every: 2 }],
  },
]

test.each(officeConformanceStages)(
  'v9 Office remediates PDF/A after built-in stages $stages',
  ({ fields, stages }) => {
    const form = adapt('office-pdf', { fields: { ...fields, pdfaProfile: 'PDF/A-2b' } }, 9)
    assert.equal(form.get('nativePdfa'), null)
    assert.deepEqual(JSON.parse(String(form.get('stages'))), [
      ...stages,
      { op: 'remediate', profile: 'PDF/A-2b' },
    ])
    assert.throws(
      () =>
        adapt(
          'office-pdf',
          { fields: { ...fields, pdfaProfile: 'PDF/A-2b', pdfaMethod: 'native' } },
          9,
        ),
      /requires PDF remediation/,
    )
  },
)

test('v9 Office keeps native conformance without PDF processing, and v8 keeps its own encoding', () => {
  const native = adapt('office-pdf', { fields: { pdfa: 'PDF/A-2b', pdfua: true } }, 9)
  assert.equal(native.get('nativePdfa'), 'PDF/A-2b')
  assert.equal(native.get('nativePdfua'), 'PDF/UA-1')
  assert.equal(native.has('stages'), false)

  const legacy = adapt('office-pdf', { fields: { pdfa: 'PDF/A-2b', merge: true } }, 8)
  assert.equal(legacy.get('pdfa'), 'PDF/A-2b')
  assert.equal(legacy.get('merge'), 'true')
  assert.equal(legacy.has('stages'), false)
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

test('v9 conversion places conformance remediation before PDF signing and timestamps', () => {
  const { operation, payload, form } = fixture('html-pdf', {
    fields: { pdfaProfile: 'PDF/A-2b' },
    conversionStages: JSON.stringify([
      { op: 'set-metadata', title: 'Final statement' },
      { op: 'sign', certificate: 'signer.p12', pades: true },
      { op: 'timestamp', timestampUrl: 'https://tsa.example.test' },
    ]),
  })
  const certificate = new File(['pkcs12'], 'signer.p12')
  const adapted = adaptConversionForm(operation, payload, form, 9, [certificate])
  assert.deepEqual(JSON.parse(String(adapted.get('stages'))), [
    { op: 'set-metadata', title: 'Final statement' },
    { op: 'remediate', profile: 'PDF/A-2b' },
    { op: 'sign', certificate: 'signer.p12', pades: true },
    { op: 'timestamp', timestampUrl: 'https://tsa.example.test/' },
  ])
})

test('v9 remediation precedes PDF/UA encryption, while PDF/A encryption remains forbidden', () => {
  const encrypt = '[{"op":"encrypt","userPassword":"secret"},{"op":"optimize"}]'
  const valid = adapt(
    'office-pdf',
    {
      fields: { pdfuaProfile: 'PDF/UA-1' },
      conversionStages: encrypt,
    },
    9,
  )
  assert.deepEqual(JSON.parse(String(valid.get('stages'))), [
    { op: 'remediate', profile: 'PDF/UA-1' },
    { op: 'encrypt', userPassword: 'secret' },
    { op: 'optimize' },
  ])
  assert.throws(
    () =>
      adapt(
        'office-pdf',
        {
          fields: { pdfaProfile: 'PDF/A-2b' },
          conversionStages: encrypt,
        },
        9,
      ),
    /cannot be encrypted/,
  )
})

test('v9 remediation precedes a final rendered output without moving earlier edits', () => {
  const form = adapt(
    'html-pdf',
    {
      fields: { pdfaProfile: 'PDF/A-4' },
      conversionStages: '[{"op":"rotate","angle":90},{"op":"render","format":"jpeg"}]',
    },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'rotate', angle: 90 },
    { op: 'remediate', profile: 'PDF/A-4' },
    { op: 'render', format: 'jpeg' },
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

test('v9 conversion-time assets match NFC filenames, including original Unicode upload names', () => {
  const decomposed = 're\u0301sume\u0301.txt'
  const normalized = decomposed.normalize('NFC')
  const { operation, payload, form } = fixture('html-pdf', {
    conversionStages: JSON.stringify([{ op: 'attach', file: decomposed }]),
  })
  const attachment = new File(['receipt'], decomposed)
  const adapted = adaptConversionForm(operation, payload, form, 9, [attachment])
  assert.deepEqual(JSON.parse(String(adapted.get('stages'))), [{ op: 'attach', file: normalized }])
  assert.equal((adapted.getAll('files').at(-1) as File).name, decomposed)
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
  const combined = adaptConversionForm(render.operation, render.payload, render.form, 9)
  assert.deepEqual(JSON.parse(String(combined.get('stages'))), [
    { op: 'remediate', profile: 'PDF/A-2b' },
    { op: 'render', pages: '1', format: 'png' },
  ])
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

test('native window.status wait remains v8 and becomes waitForWindowStatus on v9', () => {
  const v8 = adapt('url-shot', { fields: { waitWindowStatus: 'ready' } }, 8)
  const v9 = adapt('url-shot', { fields: { waitWindowStatus: 'ready' } }, 9)
  assert.equal(v8.get('waitWindowStatus'), 'ready')
  assert.equal(v8.has('waitForWindowStatus'), false)
  assert.equal(v9.get('waitForWindowStatus'), 'ready')
  assert.equal(v9.has('waitWindowStatus'), false)
})

test('v9 Office export rejects invalid bookmark expansion and clashing native watermarks', () => {
  for (const levels of ['0', '11', '100']) {
    assert.throws(
      () => adapt('office-pdf', { fields: { openBookmarkLevels: levels } }, 9),
      /bookmark expansion must be -1.*1 to 10/,
    )
  }
  for (const levels of ['-1', '1', '10']) {
    assert.equal(
      adapt('office-pdf', { fields: { openBookmarkLevels: levels } }, 9).get('openBookmarkLevels'),
      levels,
    )
  }
  const competing = { nativeWatermarkText: 'CONFIDENTIAL', nativeTiledWatermarkText: 'DRAFT' }
  assert.throws(
    () => adapt('office-pdf', { fields: competing }, 9),
    /cannot combine native watermark text with a tiled watermark/,
  )
  // v8 requests keep their original encoding and validation contract.
  assert.equal(
    adapt('office-pdf', { fields: competing }, 8).get('nativeTiledWatermarkText'),
    'DRAFT',
  )
  assert.equal(
    adapt('office-pdf', { fields: { openBookmarkLevels: '100' } }, 8).get('openBookmarkLevels'),
    '100',
  )
})

test('Gotenberg 9 LibreOffice accepts custom dimensions and named-size overrides', () => {
  const office = OPERATION_BY_ID.get('office-pdf')
  assert.ok(office)
  for (const name of ['paperWidth', 'paperHeight']) {
    const field: FieldDefinition | undefined = office.fields.find((item) => item.name === name)
    assert.ok(field)
    assert.equal(fieldSupportsBackend(field, '9.0.0'), true)
    assert.equal(fieldSupportsBackend(field, '8.40.0'), false)
  }

  const custom = adapt('office-pdf', { fields: { paperWidth: '210mm', paperHeight: '297mm' } }, 9)
  assert.equal(custom.get('paperWidth'), '210mm')
  assert.equal(custom.get('paperHeight'), '297mm')
  assert.equal(custom.has('paperSize'), false)

  const override = adapt('office-pdf', { fields: { paperSize: 'A4', paperWidth: '100mm' } }, 9)
  assert.equal(override.get('paperSize'), 'A4')
  assert.equal(override.get('paperWidth'), '100mm')
  assert.equal(override.has('paperHeight'), false)

  const defaults = adapt('office-pdf', {}, 9)
  assert.equal(defaults.has('paperSize'), false)
  assert.equal(defaults.has('paperWidth'), false)
  assert.equal(defaults.has('paperHeight'), false)
})

test('Gotenberg 9 rejects incomplete or invalid Office dimensions without affecting v8', () => {
  assert.throws(
    () => adapt('office-pdf', { fields: { paperWidth: '210mm' } }, 9),
    /both paperWidth and paperHeight, or a named paperSize/,
  )
  assert.throws(
    () => adapt('office-pdf', { fields: { paperHeight: '297mm' } }, 9),
    /both paperWidth and paperHeight, or a named paperSize/,
  )
  for (const value of ['0', '-1in', 'NaN', 'Infinity', '210em', '12in;bad']) {
    assert.throws(
      () => adapt('office-pdf', { fields: { paperSize: 'A4', paperWidth: value } }, 9),
      /positive number.*optional/,
      value,
    )
  }
  // Chromium already has a separate, long-standing custom-size contract on v8.
  assert.equal(
    adapt('html-pdf', { fields: { paperWidth: '8in', paperHeight: '11in' } }, 8).get('paperWidth'),
    '8in',
  )
  assert.throws(
    () => adapt('office-pdf', { fields: { paperWidth: '210mm', paperHeight: '297mm' } }, 8),
    /Custom Office paper dimensions require Gotenberg 9/,
  )
})

test('Gotenberg 9 validates Chromium transparency and screenshot quality at the adapter boundary', () => {
  assert.throws(
    () => adapt('html-pdf', { fields: { omitBackground: true } }, 9),
    /transparency requires Print background graphics/,
  )
  const pdf = adapt('html-pdf', { fields: { omitBackground: true, printBackground: true } }, 9)
  assert.equal(pdf.get('omitBackground'), 'true')
  assert.equal(pdf.get('printBackground'), 'true')
  // Screenshots do not use printBackground, and the original v8 form is unchanged.
  assert.equal(
    adapt('html-shot', { fields: { omitBackground: true } }, 9).get('omitBackground'),
    'true',
  )
  assert.equal(
    adapt('html-pdf', { fields: { omitBackground: true } }, 8).get('omitBackground'),
    'true',
  )

  assert.throws(
    () => adapt('html-shot', { fields: { quality: '0' } }, 9),
    /screenshot quality must be between 1 and 100/,
  )
  assert.equal(adapt('html-shot', { fields: { quality: '1' } }, 9).get('quality'), '1')
  assert.equal(adapt('html-shot', { fields: { quality: '0' } }, 8).get('quality'), '0')
})

test('Gotenberg 9 LibreOffice retains native JPEG and downsampling settings', () => {
  const form = adapt(
    'office-pdf',
    { fields: { quality: '84', reduceImageResolution: true, maxImageResolution: '150' } },
    9,
  )
  assert.equal(form.get('nativeQuality'), '84')
  assert.equal(form.get('nativeReduceImageResolution'), 'true')
  assert.equal(form.get('nativeMaxImageResolution'), '150')
  for (const legacy of ['quality', 'reduceImageResolution', 'maxImageResolution']) {
    assert.equal(form.has(legacy), false)
  }
  const old = adapt(
    'office-pdf',
    { fields: { quality: '84', reduceImageResolution: true, maxImageResolution: '150' } },
    8,
  )
  assert.equal(old.get('quality'), '84')
  assert.equal(old.get('reduceImageResolution'), 'true')
  assert.equal(old.get('maxImageResolution'), '150')
})

test('v9 Chromium forwards extended media feature maps without prototype collisions', () => {
  const features = Array.from({ length: 20 }, (_, i) => ({
    name: `extended-css-feature-${i}`,
    value: `value-${'long'.repeat(40)}`,
  }))
  features.push({ name: '__proto__', value: 'allowed-by-upstream' })
  const form = adapt(
    'url-shot',
    {
      fields: { url: 'https://example.test' },
      advanced: { emulatedMediaFeatures: JSON.stringify(features) },
    },
    9,
  )
  assert.deepEqual(
    JSON.parse(String(form.get('emulatedMediaFeatures'))),
    Object.fromEntries(features.map(({ name, value }) => [name, value])),
  )
})

test('v9 Chromium conversion forwards optional PDF remediation settings without leaking form fields', () => {
  const form = adapt(
    'html-pdf',
    {
      fields: {
        pdfaProfile: 'PDF/A-4f',
        pdfuaProfile: 'PDF/UA-2',
        v9Language: '  en-AU  ',
        v9Aggressive: true,
        v9FigureAltText: '  Figure description  ',
      },
    },
    9,
  )
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    {
      op: 'remediate',
      profile: ['PDF/A-4f', 'PDF/UA-2'],
      language: 'en-AU',
      aggressive: true,
      figureAltText: '  Figure description  ',
    },
  ])
  for (const key of ['v9Language', 'v9Aggressive', 'v9FigureAltText']) {
    assert.equal(form.has(key), false)
  }
})

test('v9 Office switches from native export to remediation when remediation settings are requested', () => {
  const options = {
    fields: {
      pdfaProfile: 'PDF/A-2b',
      v9Language: 'en-AU',
      v9FigureAltText: 'Missing alt text',
    },
  }
  const auto = adapt('office-pdf', options, 9)
  assert.equal(auto.get('nativePdfa'), null)
  assert.deepEqual(JSON.parse(String(auto.get('stages'))), [
    {
      op: 'remediate',
      profile: 'PDF/A-2b',
      language: 'en-AU',
      figureAltText: 'Missing alt text',
    },
  ])
  assert.throws(
    () => adapt('office-pdf', { fields: { ...options.fields, pdfaMethod: 'native' } }, 9),
    /requires PDF remediation/,
  )
  assert.throws(
    () => adapt('office-pdf', { fields: { v9Aggressive: true } }, 9),
    /Choose PDF\/A or PDF\/UA/,
  )
  assert.throws(
    () => adapt('url-pdf', { fields: { v9Language: 'en-AU' } }, 9),
    /Choose PDF\/A or PDF\/UA/,
  )
})

test('v8 conversion rejects Gotenberg 9 remediation stage options', () => {
  assert.throws(
    () => adapt('office-pdf', { fields: { pdfa: 'PDF/A-2b', v9Language: 'en-AU' } }, 8),
    /require Gotenberg 9|Unsupported|Advanced/,
  )
})
