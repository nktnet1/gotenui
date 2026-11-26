import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { OPERATION_BY_ID } from '#/lib/operations'
import { parsePdfValidationReport } from '#/lib/pdf-validation-report'
import { JobPanel } from '#/tools/shared/job-panel'

const operation = OPERATION_BY_ID.get('pdf-validate')
assert.ok(operation)

test('compliant Factur-X findings remain visible with review guidance', () => {
  const validation = parsePdfValidationReport(
    JSON.stringify({
      'invoice.pdf': {
        profile: 'Factur-X',
        compliant: true,
        violations: [{ description: 'Optional rule warning', severity: 'warning' }],
      },
    }),
  )
  assert.ok(validation)
  const html = renderToStaticMarkup(
    createElement(JobPanel, {
      operation,
      backendVersion: '9.3.0',
      files: [],
      auxFiles: [],
      postFiles: {},
      documentText: [],
      pending: false,
      lastDownload: {
        name: 'report.json',
        url: 'blob:pdf-validation-report',
        type: 'application/json',
        size: 200,
        validation,
      },
      recent: [],
      onClearResult: () => {},
      acceptedWebhook: null,
    }),
  )
  assert.match(html, /Report requires review/)
  assert.match(html, /Compliant with findings/)
  assert.match(html, /Optional rule warning/)
  assert.doesNotMatch(html, /Validation complete: compliant</)
})

function overview(id: string, options: Record<string, unknown> = {}) {
  const selected = OPERATION_BY_ID.get(id)
  assert.ok(selected)
  const props = {
    operation: selected,
    backendVersion: '9.10.0',
    files: [],
    auxFiles: [],
    postFiles: {},
    documentText: [],
    pending: false,
    lastDownload: null,
    recent: [],
    onClearResult: () => {},
    acceptedWebhook: null,
    ...options,
  }
  return renderToStaticMarkup(createElement(JobPanel, props))
}

test('job overview counts archives, stage assets and generated document bytes', () => {
  const html = overview('markdown-pdf', {
    files: [new File(['ab'], 'style.css')],
    archives: [new File(['123'], 'assets.zip')],
    stageFiles: [new File(['4567'], 'stamp.png')],
    documentText: ['source', 'extra', 'template', 'header', 'footer'],
  })
  assert.match(html, /Files selected<\/span><span[^>]*>3<\/span>/)
  assert.match(html, /Upload size<\/span><span[^>]*>40 B<\/span>/)
})

test.each([
  ['extract-text', { fields: { format: 'markdown' } }, 'MD / ZIP'],
  [
    'pdf-pipeline',
    { fields: { stages: '[{"op":"extract-text","format":"markdown"}]' } },
    'MD / ZIP',
  ],
  ['pdf-pipeline', { fields: { stages: '[{"op":"render","format":"jpeg"}]' } }, 'JPEG / ZIP'],
  ['pdf-pipeline', { fields: { stages: '[{"op":"merge"}]' } }, 'PDF'],
  ['html-pdf', { conversionStages: '[{"op":"extract-text","format":"markdown"}]' }, 'ZIP'],
])('job overview reflects the configured output for %s', (id, options, expected) => {
  const html = overview(id, options)
  assert.ok(html.includes(`>${expected}</span>`), `Expected target output ${expected}`)
})

test.each([
  { type: 'application/pdf', text: 'Preview PDF' },
  { type: 'application/zip', text: 'View archive contents' },
  { type: 'image/png', text: 'alt="Latest screenshot"' },
])(
  'direct result hides an unverified attachment preview for $type without hiding its download',
  ({ type, text }) => {
    const download = {
      name: 'attachment',
      url: 'blob:attachment',
      type,
      size: 5,
      blob: new Blob(['hello']),
    }
    const valid = overview('extract-attachments', {
      lastDownload: { ...download, binaryPreviewAllowed: true },
    })
    assert.ok(valid.includes(text))
    const invalid = overview('extract-attachments', {
      lastDownload: { ...download, binaryPreviewAllowed: false },
    })
    assert.ok(!invalid.includes(text))
    assert.match(invalid, /Download again/)
  },
)

test('direct results use the same raster allowlist as batch previews', () => {
  const html = overview('extract-attachments', {
    lastDownload: { name: 'attachment.svg', url: 'blob:svg', type: 'image/svg+xml', size: 6 },
  })
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /Download again/)
})
