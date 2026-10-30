import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { PdfConversionPostProcessing } from '#/components/pdf-conversion-post-processing'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { PDF_POST_PROCESS_IDS, type PostProcessFiles } from '#/lib/pdf-post-processing'
import { validateFiles, validatePayload } from '#/lib/validation'

const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })
const attachment = new File(['Attachment'], 'specification.txt', { type: 'text/plain' })
const image = new File(['PNG'], 'logo.png', { type: 'image/png' })
const invoice = new File(['<Invoice />'], 'invoice.xml', { type: 'text/xml' })

function request(
  id: string,
  postProcess: Record<string, unknown>,
  postFiles: PostProcessFiles = {},
  overrides: { fields?: Record<string, string | boolean>; advanced?: Record<string, string> } = {},
) {
  const definition = OPERATION_BY_ID.get(id)
  assert.ok(definition)
  const candidate = {
    operation: id,
    fields: {
      ...operationDefaults(definition),
      ...(definition.input === 'url' ? { url: 'https://example.test' } : {}),
      ...(id === 'split' ? { splitMode: 'pages', splitSpan: '1-2' } : {}),
      ...overrides.fields,
    },
    advanced: overrides.advanced ?? {},
    ...(definition.input === 'html' ? { source: '<html><body>Example</body></html>' } : {}),
    ...(definition.input === 'markdown' ? { source: '# Example' } : {}),
    postProcess,
  }
  const { operation, payload } = validatePayload(candidate)
  const files =
    id === 'merge'
      ? [pdf('first.pdf'), pdf('second.pdf')]
      : id === 'split'
        ? [pdf('source.pdf')]
        : id === 'office-pdf'
          ? [new File(['Office'], 'source.docx')]
          : []
  validateFiles(operation, files, [], 4_000_000, payload, postFiles)
  return createGotenbergForm(operation, payload, files, [], 4_000_000, postFiles)
}

describe('composable PDF post-processing on conversion, merge and split', () => {
  test('only the six PDF-producing routes expose the shared editor', () => {
    expect([...PDF_POST_PROCESS_IDS]).toEqual([
      'url-pdf',
      'html-pdf',
      'markdown-pdf',
      'office-pdf',
      'merge',
      'split',
    ])
  })

  test.each([...PDF_POST_PROCESS_IDS])('%s rotates pages without a second API call', (id) => {
    const form = request(id, { rotateAngle: '270', rotatePages: '1-3, 5' })
    assert.deepEqual(form.getAll('rotateAngle'), ['270'])
    assert.deepEqual(form.getAll('rotatePages'), ['1-3, 5'])
    assert.equal(form.has('postProcess'), false)
  })

  test.each(['merge', 'split'])('%s combines overlays, attachments and security', (id) => {
    const form = request(
      id,
      {
        watermarks: [
          { source: 'text', expression: 'CONFIDENTIAL' },
          { source: 'image', expression: image.name, pages: '1-2' },
        ],
        stamps: [{ source: 'text', expression: 'REVIEWED' }],
        embedsMetadata:
          '{"specification.txt":{"mimeType":"text/plain","relationship":"Supplement"}}',
        flatten: true,
        ownerPassword: 'owner-secret',
        allowCopying: false,
        rotateAngle: '90',
      },
      { watermark: image, embeds: [attachment] },
    )
    assert.equal(form.getAll('files').length, id === 'merge' ? 2 : 1)
    assert.deepEqual(form.getAll('watermarkSource'), ['text', 'image'])
    assert.deepEqual(form.getAll('watermarkExpression'), ['CONFIDENTIAL', 'logo.png'])
    assert.equal((form.get('watermark') as File).name, 'logo.png')
    assert.equal(form.get('stampExpression'), 'REVIEWED')
    assert.equal((form.get('embeds') as File).name, 'specification.txt')
    assert.equal(form.get('flatten'), 'true')
    assert.equal(form.get('ownerPassword'), 'owner-secret')
    assert.equal(form.get('allowCopying'), 'false')
    assert.equal(form.get('rotateAngle'), '90')
    assert.equal(form.has('rotatePages'), false)
  })

  test.each(['merge', 'split'])('%s accepts remote overlays and attachments', (id) => {
    const definition = OPERATION_BY_ID.get(id)
    assert.ok(definition)
    const { operation, payload } = validatePayload({
      operation: id,
      fields: {
        ...operationDefaults(definition),
        ...(id === 'split' ? { splitSpan: '1-2' } : {}),
      },
      advanced: {},
      postProcess: {
        stamps: [{ source: 'image', expression: 'remote.png' }],
        embedsMetadata: '{"invoice.xml":{"relationship":"Alternative"}}',
      },
      downloadFrom: [
        { url: 'https://example.test/remote.png', field: 'stamp' },
        { url: 'https://example.test/invoice.xml', field: 'embedded' },
      ],
    })
    const inputs = id === 'merge' ? [pdf('one.pdf'), pdf('two.pdf')] : [pdf('one.pdf')]
    validateFiles(operation, inputs, [], 4_000_000, payload)
    const result = createGotenbergForm(operation, payload, inputs, [])
    assert.equal(result.get('stampExpression'), 'remote.png')
    assert.equal(result.get('stampSource'), 'image')
    assert.equal(result.getAll('stamp').length, 0)
    assert.equal(result.getAll('embeds').length, 0)
    assert.equal(JSON.parse(String(result.get('downloadFrom'))).length, 2)
  })

  test.each(['merge', 'split'])('%s supports e-invoice XML in the same request', (id) => {
    const form = request(
      id,
      { facturxConformanceLevel: 'EN 16931', facturxDocumentType: 'INVOICE' },
      { facturxXml: invoice },
      { fields: { pdfa: 'PDF/A-3b' } },
    )
    assert.equal(form.get('facturxConformanceLevel'), 'EN 16931')
    assert.equal((form.get('facturxXml') as File).name, 'invoice.xml')
    assert.equal(form.getAll('files').length, id === 'merge' ? 2 : 1)
  })

  test('merge preserves its existing metadata field and split gains the shared metadata editor', () => {
    const metadata = '{"Title":"Merged report"}'
    const form = request('merge', { flatten: true }, {}, { fields: { metadata } })
    assert.deepEqual(form.getAll('metadata'), [metadata])
    assert.equal(form.get('flatten'), 'true')
    assert.deepEqual(request('split', { metadata }).getAll('metadata'), [metadata])
    assert.throws(() => request('merge', { metadata }, {}, { fields: { metadata } }), /not both/)
  })

  test.each(['merge', 'split'])('%s rejects invalid or incomplete rotation options', (id) => {
    assert.throws(() => request(id, { rotateAngle: '45' }), /Invalid/)
    assert.throws(() => request(id, { rotatePages: '1-2' }), /Choose a rotation angle/)
    assert.throws(
      () => request(id, { rotateAngle: '90', rotatePages: '1;2' }),
      /Rotation pages must/,
    )
    assert.throws(
      () => request(id, { rotateAngle: '90' }, {}, { advanced: { rotateAngle: '180' } }),
      /not both/,
    )
    assert.equal(request(id, { rotateAngle: '180' }).get('rotateAngle'), '180')
  })

  test.each(['merge', 'split'])('%s enforces attachment and overlay safety', (id) => {
    assert.throws(
      () => request(id, { watermarks: [{ source: 'image', expression: 'logo.png' }] }),
      /exactly one local or remote watermark/,
    )
    assert.throws(() => request(id, { embedsMetadata: '{}' }), /needs an embedded file/)
    assert.throws(
      () => request(id, {}, { embeds: [attachment] }, { fields: { pdfa: 'PDF/A-2b' } }),
      /Only PDF\/A-3 supports/,
    )
    assert.throws(() => request(id, { facturxConformanceLevel: 'MINIMUM' }), /requires both/)
  })

  test.each(['convert', 'merge', 'split'] as const)(
    '%s renders appropriate shared controls without duplicating merge metadata',
    (mode) => {
      const html = renderToStaticMarkup(
        createElement(PdfConversionPostProcessing, {
          mode,
          value: { rotateAngle: '90' },
          onChange: () => {},
          files: {},
          onFilesChange: () => {},
        }),
      )
      expect(html).toContain('PDF post-processing (optional)')
      expect(html).toContain('Rotation angle')
      expect(html).toContain('Pages to rotate (optional)')
      expect(html).toContain('Embed files')
      expect(html).toContain('Factur-X / ZUGFeRD invoice')
      expect(html).toContain('Encrypt result')
      expect(html.includes('PDF metadata')).toBe(mode !== 'merge')
      if (mode === 'split') expect(html).toContain('split PDFs')
      if (mode === 'merge') expect(html).toContain('merged PDF')
    },
  )
})
