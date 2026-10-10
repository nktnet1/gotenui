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

describe('Ordered, repeated watermark and stamp groups (v1.0.22)', () => {
  const watermarkPdf = new File(['%PDF-1.7'], 'background.pdf', { type: 'application/pdf' })
  const stampLogo = new File(['PNG DATA'], 'approved.png', { type: 'image/png' })

  test.each(['url-pdf', 'html-pdf', 'markdown-pdf', 'office-pdf'])(
    '%s serializes every parallel field and preserves mixed text/image/PDF ordering',
    (id) => {
      const result = form(
        id,
        {
          postProcess: {
            watermarks: [
              { source: 'text', expression: 'DRAFT', options: '{"opacity":0.1}' },
              { source: 'image', expression: 'logo.png', pages: '1, 3' },
              { source: 'pdf', expression: 'background.pdf', options: '{"scale":0.5}' },
            ],
            stamps: [
              { source: 'pdf', expression: 'foreground.pdf' },
              { source: 'text', expression: 'REVIEWED', pages: '2' },
              { source: 'image', expression: 'approved.png' },
            ],
          },
        },
        {
          // Deliberately submit the uploads out of order; Gotenui sorts by overlay row.
          watermark: [watermarkPdf, logo],
          stamp: [stampLogo, new File(['PDF'], 'foreground.pdf')],
        },
      )
      assert.deepEqual(result.getAll('watermarkSource'), ['text', 'image', 'pdf'])
      assert.deepEqual(result.getAll('watermarkExpression'), [
        'DRAFT',
        'logo.png',
        'background.pdf',
      ])
      assert.deepEqual(result.getAll('watermarkPages'), ['', '1, 3', ''])
      assert.deepEqual(result.getAll('watermarkOptions'), ['{"opacity":0.1}', '', '{"scale":0.5}'])
      assert.deepEqual(result.getAll('stampSource'), ['pdf', 'text', 'image'])
      assert.deepEqual(result.getAll('stampExpression'), [
        'foreground.pdf',
        'REVIEWED',
        'approved.png',
      ])
      assert.deepEqual(result.getAll('stampPages'), ['', '2', ''])
      assert.deepEqual(result.getAll('stampOptions'), ['', '', ''])
      assert.deepEqual(
        (result.getAll('watermark') as File[]).map((file) => file.name),
        ['logo.png', 'background.pdf'],
      )
      assert.deepEqual(
        (result.getAll('stamp') as File[]).map((file) => file.name),
        ['foreground.pdf', 'approved.png'],
      )
      assert.equal(
        result.getAll('files').length,
        id === 'markdown-pdf' ? 2 : id === 'url-pdf' ? 0 : 1,
      )
    },
  )

  test.each(['watermark', 'stamp'])(
    'standalone %s tool uses the same ordered groups without legacy fields',
    (kind) => {
      const plural = kind === 'watermark' ? 'watermarks' : 'stamps'
      const result = form(
        kind,
        {
          fields: {},
          postProcess: {
            [plural]: [
              { source: 'text', expression: 'FIRST' },
              { source: 'pdf', expression: 'background.pdf' },
              { source: 'text', expression: 'LAST', pages: '1' },
            ],
          },
        },
        { [kind]: [watermarkPdf] },
        [new File(['%PDF-1.7'], 'source.pdf')],
      )
      assert.deepEqual(result.getAll(`${kind}Source`), ['text', 'pdf', 'text'])
      assert.deepEqual(result.getAll(`${kind}Expression`), ['FIRST', 'background.pdf', 'LAST'])
      assert.equal((result.get(kind) as File).name, 'background.pdf')
      assert.deepEqual(result.getAll(`${kind}Pages`), ['', '', '1'])
    },
  )

  test('retains v1.0.21 single-overlay serialization and rejects single/plural collisions', () => {
    const original = form(
      'url-pdf',
      { postProcess: { watermark: { source: 'image' } } },
      { watermark: logo },
    )
    assert.deepEqual(original.getAll('watermarkSource'), ['image'])
    assert.deepEqual(original.getAll('watermarkExpression'), ['logo.png'])
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: {
            watermark: { source: 'text', expression: 'OLD' },
            watermarks: [{ source: 'text', expression: 'NEW' }],
          },
        }),
      /not both/,
    )
  })

  test('accepts multiple remote inputs ordered before local uploads and rejects reversed ordering', () => {
    const downloadFrom = [
      { url: 'https://assets.example/one.png', field: 'watermark' },
      { url: 'https://assets.example/two.pdf', field: 'watermark' },
    ]
    const rows = [
      { source: 'text', expression: 'TITLE' },
      { source: 'image', expression: 'one.png' },
      { source: 'pdf', expression: 'two.pdf' },
      { source: 'image', expression: 'logo.png' },
    ]
    const valid = form(
      'url-pdf',
      { postProcess: { watermarks: rows }, downloadFrom },
      { watermark: [logo] },
    )
    assert.deepEqual(valid.getAll('watermarkSource'), ['text', 'image', 'pdf', 'image'])
    assert.deepEqual(JSON.parse(String(valid.get('downloadFrom'))), downloadFrom)
    assert.equal((valid.get('watermark') as File).name, 'logo.png')
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { watermarks: [rows[3], rows[1], rows[2]] }, downloadFrom },
          { watermark: [logo] },
        ),
      /Remote watermark overlays must precede local uploads/,
    )
  })

  test('rejects unused remote overlays and filenames colliding with a source PDF', () => {
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { metadata: '{"Author":"Gotenui"}' },
          downloadFrom: [{ url: 'https://assets.example/unused.png', field: 'watermark' }],
        }),
      /watermark downloadFrom requires matching watermark settings/,
    )
    assert.throws(
      () =>
        form(
          'stamp',
          {
            fields: {},
            postProcess: { stamps: [{ source: 'text', expression: 'OK' }] },
            downloadFrom: [{ url: 'https://assets.example/unused.png', field: 'stamp' }],
          },
          {},
          [new File(['PDF bytes'], 'original.pdf')],
        ),
      /exactly one local or remote stamp|Text stamp must not include/,
    )
    assert.throws(
      () =>
        form(
          'stamp',
          {
            fields: {},
            postProcess: { stamps: [{ source: 'pdf', expression: 'source.pdf' }] },
          },
          { stamp: [new File(['pdf'], 'source.pdf')] },
          [new File(['pdf'], 'source.pdf')],
        ),
      /Overlay filename collides with an input or asset/,
    )
  })

  test('rejects missing, duplicate, wrongly typed, and excess overlay assets', () => {
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { watermarks: [{ source: 'image', expression: 'one.png' }] },
        }),
      /exactly one local or remote watermark/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          {
            postProcess: {
              watermarks: [
                { source: 'image', expression: 'logo.png' },
                { source: 'image', expression: 'logo.png' },
              ],
            },
          },
          { watermark: [logo, logo] },
        ),
      /Duplicate watermark upload filename|Duplicate overlay filename/,
    )
    assert.throws(
      () =>
        form(
          'url-pdf',
          { postProcess: { stamps: [{ source: 'pdf', expression: 'image.png' }] } },
          { stamp: [logo] },
        ),
      /source type/,
    )
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: {
            stamps: Array.from({ length: 11 }, () => ({ source: 'text', expression: 'X' })),
          },
        }),
      /10/,
    )
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { stamps: [{ source: 'text', expression: 'X', options: '[]' }] },
        }),
      /JSON object/,
    )
    assert.throws(
      () =>
        form('url-pdf', {
          postProcess: { stamps: [{ source: 'text', expression: 'X', pages: '1;2' }] },
        }),
      /pages must/,
    )
    assert.throws(
      () =>
        form(
          'stamp',
          {
            fields: {},
            postProcess: { stamps: [{ source: 'text', expression: 'DRAFT' }], metadata: '{}' },
          },
          {},
          [new File(['pdf'], 'source.pdf')],
        ),
      /accepts only ordered stamps/,
    )
    assert.throws(
      () =>
        form(
          'watermark',
          { postProcess: { watermarks: [{ source: 'text', expression: 'W' }] } },
          {},
          [new File(['pdf'], 'source.pdf')],
        ),
      /not both/,
    )
  })
})
