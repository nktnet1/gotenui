import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { importReadableBookmarks, importReadableMetadata } from '#/lib/pdf-read-import'
import { activeOperationFields, OPERATION_BY_ID, operationDefaults } from '#/tools/registry'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'
const pdf = () => new File(['%PDF-1.7\n'], 'report.pdf', { type: 'application/pdf' })
const attachment = () => new File(['notes'], 'notes.txt', { type: 'text/plain' })

function requestFor(
  id: string,
  fields: Record<string, string | boolean> = {},
  options: {
    auxiliary?: File[]
    files?: File[]
    advanced?: Record<string, string | boolean>
    postProcess?: unknown
    downloadFrom?: unknown[]
  } = {},
) {
  const tool = OPERATION_BY_ID.get(id)
  assert.ok(tool)
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: id,
      fields: { ...operationDefaults(tool), ...fields },
      advanced: options.advanced ?? {},
      ...(options.postProcess ? { postProcess: options.postProcess } : {}),
      ...(options.downloadFrom ? { downloadFrom: options.downloadFrom } : {}),
    }),
  )
  for (const file of options.files ?? [pdf()]) body.append('files', file, file.name)
  for (const file of options.auxiliary ?? []) body.append('auxiliary', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function fixture(
  version: '8.40.0' | '9.0.0',
  callback: (form: FormData, path: string) => void,
  response?: Response,
) {
  let forwarded = 0
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === `${upstream}/version`) return new Response(version)
    forwarded++
    assert.equal(init?.method, 'POST')
    assert.ok(init?.body instanceof FormData)
    callback(init.body, new URL(String(input)).pathname)
    return (
      response ?? new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } })
    )
  }
  return { fetcher, count: () => forwarded }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9 standalone PDF routes and stages', () => {
  it.each([
    ['merge', {}, [{ op: 'merge' }]],
    ['split', { splitMode: 'intervals', splitSpan: '2' }, [{ op: 'split', every: 2 }]],
    [
      'split',
      { splitMode: 'pages', splitSpan: '1-2,4', splitUnify: true },
      [{ op: 'select', pages: '1-2,4' }],
    ],
    ['split', { splitMode: 'pages', splitSpan: '1-2,4' }, [{ op: 'split', ranges: ['1-2', '4'] }]],
    [
      'pdfa',
      { pdfa: 'PDF/A-2b', pdfua: true },
      [{ op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] }],
    ],
    [
      'pdfa',
      { pdfa: 'PDF/A-4', pdfua: true },
      [{ op: 'remediate', profile: ['PDF/A-4', 'PDF/UA-2'] }],
    ],
    ['optimize', {}, [{ op: 'optimize' }]],
    [
      'rotate',
      { rotateAngle: '270', rotatePages: '1-3' },
      [{ op: 'rotate', angle: 270, pages: '1-3' }],
    ],
    ['flatten', { v9FlattenFormsOnly: true }, [{ op: 'flatten-form' }]],
    [
      'encrypt',
      { userPassword: 'pass', allowCopying: false, allowPrinting: false },
      [
        {
          op: 'encrypt',
          userPassword: 'pass',
          permissions: {
            print: false,
            printHighQuality: false,
            extractText: false,
            modifyContent: true,
            modifyAnnotations: true,
            fillForms: true,
            assemble: true,
          },
        },
      ],
    ],
    [
      'stamp',
      { stampSource: 'text', stampExpression: 'APPROVED', v9OverlayAcknowledged: true },
      [{ op: 'stamp-text', text: 'APPROVED', x: 48, y: 48, fontSize: 24 }],
    ],
    [
      'watermark',
      { watermarkSource: 'text', watermarkExpression: 'DRAFT', v9OverlayAcknowledged: true },
      [{ op: 'stamp-text', text: 'DRAFT', x: 48, y: 48, fontSize: 24 }],
    ],
    [
      'metadata-write',
      { metadata: '{"Author":"Alice","Title":"Hello","Keywords":["a","b"]}' },
      [{ op: 'set-metadata', author: 'Alice', title: 'Hello', keywords: 'a, b' }],
    ],
    [
      'bookmarks-write',
      { bookmarks: '[{"title":"Chapter","page":1,"children":[{"title":"Subchapter","page":1}]}]' },
      [
        {
          op: 'set-bookmarks',
          bookmarks: [
            { title: 'Chapter', pageNumber: 1, children: [{ title: 'Subchapter', pageNumber: 1 }] },
          ],
        },
      ],
    ],
  ] as const)('maps %s to v9 stages', async (id, fields, stages) => {
    const remote = fixture('9.0.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), stages)
      assert.ok(form.get('files') instanceof File)
      assert.equal(form.get('rotateAngle'), null)
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor(id, fields, {
            files: id === 'merge' ? [pdf(), new File(['%PDF-1.7\n'], 'second.pdf')] : undefined,
          }),
          remote.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(remote.count(), 1)
  })

  it('keeps v8 routes and original fields unchanged', async () => {
    const remote = fixture('8.40.0', (form, path) => {
      assert.equal(path, '/forms/pdfengines/rotate')
      assert.equal(form.get('rotateAngle'), '90')
      assert.equal(form.get('stages'), null)
    })
    assert.equal(
      (await proxyConversionRequest(requestFor('rotate', { rotateAngle: '90' }), remote.fetcher))
        .status,
      200,
    )
  })

  it.each([
    ['metadata-read', '/forms/pdf/metadata'],
    ['bookmarks-read', '/forms/pdf/bookmarks'],
  ])('uses v9 JSON read route for %s', async (id, path) => {
    const remote = fixture(
      '9.0.0',
      (form, url) => {
        assert.equal(url, path)
        assert.equal(form.get('stages'), null)
      },
      new Response('{"report.pdf":{}}', { headers: { 'content-type': 'application/json' } }),
    )
    const result = await proxyConversionRequest(requestFor(id), remote.fetcher)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('content-type'), 'application/json')
    assert.deepEqual(await result.json(), { 'report.pdf': {} })
  })

  it('relabels attachment uploads as files and emits one attach stage per file', async () => {
    const remote = fixture('9.0.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'attach', file: 'notes.txt', relationship: 'Data', mimeType: 'text/plain' },
      ])
      assert.equal(form.getAll('files').length, 2)
      assert.equal(form.get('embeds'), null)
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor(
            'embed',
            { embedsMetadata: '{"notes.txt":{"relationship":"Data","mimeType":"text/plain"}}' },
            { auxiliary: [attachment()] },
          ),
          remote.fetcher,
        )
      ).status,
      200,
    )
  })

  it('encodes v9 Factur-X as a remediation with uploaded XML', async () => {
    const remote = fixture('9.0.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'remediate', profile: 'Factur-X', xml: 'invoice.xml', level: 'MINIMUM' },
      ])
      assert.equal(form.getAll('files').length, 2)
      assert.equal(form.get('facturxXml'), null)
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor(
            'factur-x',
            { facturxConformanceLevel: 'MINIMUM' },
            { auxiliary: [new File(['<xml/>'], 'invoice.xml')] },
          ),
          remote.fetcher,
        )
      ).status,
      200,
    )
  })

  it('converts legacy opacity to inverse litho opacity without assuming equal defaults', async () => {
    const remote = fixture('9.0.0', (form) => {
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        {
          op: 'stamp-text',
          text: 'hello',
          x: 20,
          y: 30,
          fontSize: 16,
          opacity: 0.75,
          rotation: 45,
        },
      ])
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('stamp', {
            stampSource: 'text',
            stampExpression: 'hello',
            stampOptions: '{"opacity":0.25,"rotation":45}',
            v9OverlayAcknowledged: true,
            v9OverlayX: '20',
            v9OverlayY: '30',
            v9OverlayFontSize: '16',
          }),
          remote.fetcher,
        )
      ).status,
      200,
    )
  })

  it.each([
    ['optimize', { imageQuality: '70' }, /lossless/],
    ['merge', { autoIndexBookmarks: true }, /bookmark/],
    ['metadata-write', { metadata: '{"Copyright":"text"}' }, /cannot write/],
    [
      'bookmarks-write',
      { bookmarks: '{"report.pdf":[{"title":"A","page":1}]}' },
      /shared bookmark tree/,
    ],
    ['factur-x', { facturxConformanceLevel: 'MINIMUM', facturxVersion: '1.0' }, /does not support/],
    ['factur-x', { facturxConformanceLevel: 'MINIMUM', pdfa: 'PDF/A-3a' }, /PDF\/A-3b/],
    ['factur-x', { facturxConformanceLevel: 'MINIMUM', pdfa: 'PDF/A-3u' }, /PDF\/A-3b/],
    ['stamp', { stampSource: 'text', stampExpression: 'hi' }, /Confirm this difference/],
    [
      'watermark',
      { watermarkSource: 'text', watermarkExpression: 'hi' },
      /Confirm this difference/,
    ],
    ['flatten', {}, /form fields, not annotations/],
  ] as const)('rejects unsafe v9 field translations for %s', async (id, fields, reason) => {
    const remote = fixture('9.0.0', () => {
      throw new Error('Should not forward')
    })
    await assert.rejects(
      proxyConversionRequest(
        requestFor(
          id,
          fields,
          id === 'factur-x'
            ? { auxiliary: [new File(['<xml/>'], 'invoice.xml')] }
            : id === 'merge'
              ? { files: [pdf(), new File(['%PDF-1.7\n'], 'second.pdf')] }
              : undefined,
        ),
        remote.fetcher,
      ),
      reason,
    )
    assert.equal(remote.count(), 0)
  })

  it('surfaces bounded remediation diagnostics, without accepting arbitrary headers', async () => {
    const remote = fixture(
      '9.0.0',
      () => {},
      new Response('%PDF-1.7\n', {
        headers: {
          'content-type': 'application/pdf',
          'Gotenberg-Remediation-Residual': '7',
          'Gotenberg-Remediation-Rolled-Back': '2',
          'Gotenberg-Trace': 'abc',
          'Gotenberg-Remediation-Fake': 'yes',
        },
      }),
    )
    const result = await proxyConversionRequest(
      requestFor('pdfa', { pdfa: 'PDF/A-2b' }),
      remote.fetcher,
    )
    assert.equal(result.headers.get('Gotenberg-Remediation-Residual'), '7')
    assert.equal(result.headers.get('Gotenberg-Remediation-Rolled-Back'), '2')
    assert.equal(result.headers.get('Gotenberg-Remediation-Fake'), null)
  })
})

describe('version-specific merge editor fields', () => {
  it('hides v8-only bookmark and metadata controls on v9, preserving v8 defaults', () => {
    const operation = OPERATION_BY_ID.get('merge')
    assert.ok(operation)
    const settings = {
      ...operationDefaults(operation),
      autoIndexBookmarks: true,
      titleBookmarks: true,
      bookmarks: '[{"title":"Start","page":1}]',
      metadata: '{"Author":"Gotenui"}',
      pdfa: 'PDF/A-2b',
    }
    const v8 = activeOperationFields(operation, settings, '8.40.0')
    const v9 = activeOperationFields(operation, settings, '9.0.0')
    assert.equal(v8.autoIndexBookmarks, true)
    assert.equal(v8.titleBookmarks, true)
    assert.equal(v8.bookmarks, settings.bookmarks)
    assert.equal(v8.metadata, settings.metadata)
    assert.equal(v9.autoIndexBookmarks, undefined)
    assert.equal(v9.titleBookmarks, undefined)
    assert.equal(v9.bookmarks, undefined)
    assert.equal(v9.metadata, undefined)
    assert.equal(v9.pdfa, 'PDF/A-2b')
  })
})

describe('v8 and v9 standalone overlay field visibility', () => {
  it.each(['stamp', 'watermark'] as const)(
    '%s keeps v8 fields but exposes the v9 acknowledgment and coordinates only on v9',
    (id) => {
      const operation = OPERATION_BY_ID.get(id)
      assert.ok(operation)
      const candidate = {
        ...operationDefaults(operation),
        [`${id}Expression`]: 'Approval',
        v9OverlayAcknowledged: true,
        v9OverlayX: '72',
        v9OverlayFontSize: '18',
      }
      const v8 = activeOperationFields(operation, candidate, '8.40.0')
      const v9 = activeOperationFields(operation, candidate, '9.0.0')
      assert.equal(v8[`${id}Expression`], 'Approval')
      assert.equal(v8.v9OverlayAcknowledged, undefined)
      assert.equal(v8.v9OverlayX, undefined)
      assert.equal(v9.v9OverlayAcknowledged, true)
      assert.equal(v9.v9OverlayX, '72')
      assert.equal(v9[`${id}Expression`], 'Approval')
    },
  )
})

describe('v9 PDF read payload import', () => {
  it('imports v9 lowercase metadata into existing fields', () => {
    assert.deepEqual(
      JSON.parse(
        importReadableMetadata(
          { 'doc.pdf': { author: 'Alice', title: 'Hello', keywords: 'one, two' } },
          'doc.pdf',
        ),
      ),
      { Title: 'Hello', Author: 'Alice', Keywords: ['one', 'two'] },
    )
  })
  it('converts v9 nested pageNumber bookmarks to v8-compatible editor entries', () => {
    assert.deepEqual(
      JSON.parse(
        importReadableBookmarks(
          {
            'doc.pdf': [
              { title: 'Intro', pageNumber: 1, children: [{ title: 'Sub', pageNumber: 3 }] },
            ],
          },
          ['doc.pdf'],
        ),
      ),
      [{ title: 'Intro', page: 1, children: [{ title: 'Sub', page: 3 }] }],
    )
  })
})
