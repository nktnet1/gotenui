import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import type { PostProcessFiles } from '#/lib/pdf-post-processing'
import { validateFiles, validatePayload } from '#/lib/validation'

const xml = new File(['<Invoice />'], 'invoice.xml', { type: 'application/xml' })
const logo = new File(['PNG DATA'], 'logo.png', { type: 'image/png' })
const first = new File(['First embedded file'], 'first.txt')
const second = new File(['Second embedded file'], 'second.txt')

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  const operation = OPERATION_BY_ID.get(id)
  assert.ok(operation)
  return {
    operation: id,
    fields: {
      ...operationDefaults(operation),
      ...(operation.input === 'url' ? { url: 'https://example.com' } : {}),
    },
    advanced: {},
    ...(operation.input === 'html' ? { source: '<html><head></head><body>PDF</body></html>' } : {}),
    ...(operation.input === 'markdown' ? { source: '# Example' } : {}),
    ...overrides,
  }
}

function form(
  id: string,
  overrides: Record<string, unknown> = {},
  postFiles: PostProcessFiles = {},
  inputFiles?: File[],
) {
  const { operation, payload } = validatePayload(candidate(id, overrides))
  const files =
    inputFiles ?? (operation.input === 'office' ? [new File(['Office text'], 'doc.txt')] : [])
  validateFiles(operation, files, [], 4_000_000, payload, postFiles)
  return createGotenbergForm(operation, payload, files, [], 4_000_000, postFiles)
}

describe('Single-request PDF post-processing', () => {
  test.each(['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf'])(
    '%s includes watermark, stamp, metadata and flatten in the original conversion request',
    (id) => {
      const result = form(id, {
        postProcess: {
          watermark: {
            source: 'text',
            expression: 'CONFIDENTIAL',
            pages: '1-3, 5',
            options: '{"opacity":0.25}',
          },
          stamp: { source: 'text', expression: 'REVIEWED' },
          metadata: '{"Author":"Gotenui"}',
          flatten: true,
        },
      })
      assert.equal(result.get('watermarkSource'), 'text')
      assert.equal(result.get('watermarkExpression'), 'CONFIDENTIAL')
      assert.equal(result.get('watermarkPages'), '1-3, 5')
      assert.equal(result.get('watermarkOptions'), '{"opacity":0.25}')
      assert.equal(result.get('stampSource'), 'text')
      assert.equal(result.get('stampExpression'), 'REVIEWED')
      assert.equal(result.get('metadata'), '{"Author":"Gotenui"}')
      assert.equal(result.get('flatten'), 'true')
      assert.equal(result.has('postProcess'), false)
      assert.equal(result.has('payload'), false)
      assert.equal(
        result.getAll('files').length,
        id === 'markdown-pdf' ? 2 : id === 'html-pdf' || id === 'office-pdf' ? 1 : 0,
      )
    },
  )

  test('keeps local overlays separate from source documents and includes repeated embeds in order', () => {
    const stampPdf = new File(['%PDF-1.7'], 'approved.pdf', { type: 'application/pdf' })
    const result = form(
      'html-pdf',
      {
        postProcess: {
          watermark: { source: 'image' },
          stamp: { source: 'pdf' },
          embedsMetadata: '{"first.txt":{"mimeType":"text/plain","relationship":"Supplement"}}',
        },
      },
      { watermark: logo, stamp: stampPdf, embeds: [first, second] },
    )
    assert.deepEqual(
      (result.getAll('files') as File[]).map((file) => file.name),
      ['index.html'],
    )
    assert.equal(result.get('watermarkSource'), 'image')
    assert.equal(result.get('watermarkExpression'), 'logo.png')
    assert.equal(result.get('stampExpression'), 'approved.pdf')
    assert.deepEqual(
      (result.getAll('watermark') as File[]).map((file) => file.name),
      ['logo.png'],
    )
    assert.deepEqual(
      (result.getAll('stamp') as File[]).map((file) => file.name),
      ['approved.pdf'],
    )
    assert.deepEqual(
      (result.getAll('embeds') as File[]).map((file) => file.name),
      ['first.txt', 'second.txt'],
    )
  })

  test('supports local attachments without any metadata or other settings', () => {
    const result = form('url-pdf', {}, { embeds: [first] })
    assert.deepEqual(
      (result.getAll('embeds') as File[]).map((file) => file.name),
      ['first.txt'],
    )
  })

  test('passes Factur-X XML as facturxXml with conformance fields, not as a source file', () => {
    const result = form(
      'office-pdf',
      {
        fields: { pdfa: 'PDF/A-3b' },
        postProcess: {
          facturxConformanceLevel: 'MINIMUM',
          facturxDocumentType: 'INVOICE',
          facturxVersion: '1.0',
        },
      },
      { facturxXml: xml },
    )
    assert.equal(result.get('facturxConformanceLevel'), 'MINIMUM')
    assert.equal(result.get('facturxDocumentType'), 'INVOICE')
    assert.equal(result.get('facturxVersion'), '1.0')
    assert.equal((result.get('facturxXml') as File).name, 'invoice.xml')
    assert.equal((result.get('files') as File).name, 'doc.txt')
  })

  test('forwards remote embeds and overlays without local supporting files', () => {
    const remotes = [
      { url: 'https://assets.example/watermark.png', field: 'watermark' },
      { url: 'https://assets.example/attachment.txt', field: 'embedded' },
    ]
    const result = form('url-pdf', {
      postProcess: { watermark: { source: 'image', expression: 'watermark.png' } },
      downloadFrom: remotes,
    })
    assert.deepEqual(JSON.parse(String(result.get('downloadFrom'))), remotes)
    assert.equal(result.get('watermarkSource'), 'image')
    assert.equal(result.get('watermarkExpression'), 'watermark.png')
    assert.equal(result.has('watermark'), false)
    assert.equal(result.getAll('embeds').length, 0)
  })

  test('supports encryption/permissions without modifying PDF/A, and rejects PDF/A encryption', () => {
    const result = form('url-pdf', {
      postProcess: { ownerPassword: 'secret', allowCopying: false, allowPrinting: false },
    })
    assert.equal(result.get('ownerPassword'), 'secret')
    assert.equal(result.get('allowCopying'), 'false')
    assert.equal(result.get('allowPrinting'), 'false')
    assert.equal(result.has('allowModifying'), false)
    assert.throws(
      () =>
        form('url-pdf', {
          fields: { url: 'https://example.com', pdfa: 'PDF/A-3b' },
          postProcess: { userPassword: 'secret' },
        }),
      /PDF\/A and PDF encryption/,
    )
    assert.throws(
      () => form('office-pdf', { postProcess: { allowCopying: false } }),
      /permissions require/,
    )
  })

  test.each(['url-shot', 'html-shot', 'markdown-shot', 'merge', 'encrypt'])(
    '%s rejects conversion-only post processing',
    (id) => {
      assert.throws(
        () => validatePayload(candidate(id, { postProcess: { flatten: true } })),
        /only on PDF conversion/,
      )
      const operation = OPERATION_BY_ID.get(id)
      assert.ok(operation)
      const originalFiles =
        operation.input === 'pdf'
          ? [
              new File(['pdf'], 'one.pdf'),
              ...(operation.id === 'merge' ? [new File(['pdf'], 'two.pdf')] : []),
            ]
          : []
      assert.throws(
        () => validateFiles(operation, originalFiles, [], 4000, undefined, { embeds: [first] }),
        /only on PDF conversion/,
      )
    },
  )

  test('rejects missing, multiple, mismatched, or text overlay files', () => {
    assert.throws(
      () => form('url-pdf', { postProcess: { watermark: { source: 'image' } } }),
      /exactly one local or remote watermark/,
    )
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { watermark: { source: 'image' } },
          downloadFrom: [{ url: 'https://assets.example/watermark.png', field: 'watermark' }],
        }),
      /remote file's Content-Disposition filename/,
    )
    assert.throws(
      () => form('url-pdf', { postProcess: { watermark: { source: 'text', expression: '' } } }),
      /text cannot be empty/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { stamp: { source: 'image' } } },
          { stamp: new File(['PDF'], 'file.pdf') },
        ),
      /source type/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { watermark: { source: 'text', expression: 'ONE' } } },
          { watermark: logo },
        ),
      /must not include/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { watermark: { source: 'image', expression: 'other.png' } } },
          { watermark: logo },
        ),
      /expression must match/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          {
            postProcess: { watermark: { source: 'image' } },
            downloadFrom: [{ url: 'https://files.example/logo.png', field: 'watermark' }],
          },
          { watermark: logo },
        ),
      /exactly one/,
    )
  })

  test('rejects malformed options, pages, metadata, and attachment metadata', () => {
    for (const [key, value, pattern] of [
      ['watermark', { source: 'text', expression: 'W', options: '[' }, /valid JSON/],
      ['stamp', { source: 'text', expression: 'W', pages: '1;cat' }, /pages must/],
    ] as const) {
      assert.throws(() => form('url-pdf', { postProcess: { [key]: value } }), pattern)
    }
    assert.throws(
      () => form('url-pdf', { postProcess: { metadata: '["not-object"]' } }),
      /JSON object/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { embedsMetadata: '{"first.txt":{"relationship":"invalid"}}' } },
          { embeds: [first] },
        ),
      /Invalid attachment metadata/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { embedsMetadata: '{"absent.txt":{"relationship":"Data"}}' } },
          { embeds: [first] },
        ),
      /file that was not uploaded/,
    )
    assert.throws(
      () => form('url-pdf', { postProcess: { embedsMetadata: '{"first.txt":{}}' } }),
      /needs an embedded file/,
    )
  })

  test('rejects duplicate, oversized, empty, or wrongly typed upload files', () => {
    assert.throws(
      () => form('url-pdf', {}, { embeds: [first, new File(['other'], 'FIRST.TXT')] }),
      /Duplicate PDF attachment/,
    )
    assert.throws(() => form('url-pdf', {}, { embeds: [new File([], 'empty.txt')] }), /empty/)
    const parsed = validatePayload(candidate('url-pdf'))
    assert.throws(
      () =>
        validateFiles(parsed.operation, [], [], 6, parsed.payload, {
          embeds: [new File(['oversized'], 'large.txt')],
        }),
      /configured size limit/,
    )
  })

  test('rejects PDF/A 1/2 with attachments, bad Factur-X combinations and missing XML', () => {
    for (const pdfa of ['PDF/A-1b', 'PDF/A-2b']) {
      assert.throws(
        () =>
          form('url-pdf', { fields: { url: 'https://example.com', pdfa } }, { embeds: [first] }),
        /do not support embedded attachments/,
      )
      assert.throws(
        () =>
          form(
            'url-pdf',
            {
              fields: { url: 'https://example.com', pdfa },
              postProcess: { facturxConformanceLevel: 'MINIMUM' },
            },
            { facturxXml: xml },
          ),
        /Factur-X requires PDF\/A-3/,
      )
    }
    assert.throws(
      () => form('url-pdf', { postProcess: { facturxConformanceLevel: 'MINIMUM' } }),
      /requires both/,
    )
    assert.throws(
      () => form('url-pdf', {}, { facturxXml: xml }),
      /require post-processing settings/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { facturxConformanceLevel: 'MINIMUM' } },
          { facturxXml: logo },
        ),
      /XML invoice/,
    )
    assert.throws(
      () => form('url-pdf', { postProcess: { facturxDocumentType: 'ORDER' } }),
      /require a conformance level/,
    )
  })

  test('rejects overlapping Advanced JSON fields and unsupported enum values', () => {
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { watermark: { source: 'text', expression: 'Hi' } },
          advanced: { watermarkSource: 'image' },
        }),
      /not both/,
    )
    assert.throws(
      () =>
        validatePayload(
          candidate('url-pdf', { postProcess: { facturxConformanceLevel: 'UNKNOWN' } }),
        ),
      /Invalid/,
    )
  })
})
