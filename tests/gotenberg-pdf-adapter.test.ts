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
  version: '8.40.0' | '9.0.0' | '9.1.0',
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
    [
      'pdfa',
      { pdfaProfile: 'PDF/A-1b', pdfuaProfile: 'PDF/UA-1' },
      [{ op: 'remediate', profile: ['PDF/A-1b', 'PDF/UA-1'] }],
    ],
    [
      'pdfa',
      {
        pdfaProfile: 'PDF/A-4f',
        pdfuaProfile: 'PDF/UA-2',
        v9Language: 'en-AU',
        v9Aggressive: true,
        v9FigureAltText: 'Figure without a description',
      },
      [
        {
          op: 'remediate',
          profile: ['PDF/A-4f', 'PDF/UA-2'],
          language: 'en-AU',
          aggressive: true,
          figureAltText: 'Figure without a description',
        },
      ],
    ],
    ['pdfa', { pdfuaProfile: 'PDF/UA-2' }, [{ op: 'remediate', profile: 'PDF/UA-2' }]],
    ['optimize', {}, [{ op: 'optimize' }]],
    [
      'optimize',
      {
        v9ObjectStreams: 'disabled',
        v9Dedup: 'enabled',
        v9RecompressImages: 'disabled',
        v9SubsetFonts: 'disabled',
      },
      [
        {
          op: 'optimize',
          objectStreams: false,
          dedup: true,
          recompressImages: false,
          subsetFonts: false,
        },
      ],
    ],
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
      'encrypt',
      {
        userPassword: 'pass',
        allowPrinting: false,
        v9PrintHighQuality: 'allow',
        v9Algorithm: 'aes128',
      },
      [
        {
          op: 'encrypt',
          userPassword: 'pass',
          algorithm: 'aes128',
          permissions: {
            print: false,
            printHighQuality: true,
            extractText: true,
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
    ['pdfa', { pdfaProfile: 'PDF/A-3u' }, /require Gotenberg 9/],
    ['pdfa', { pdfa: 'PDF/A-1b', pdfua: true }, /cannot combine/],
    ['optimize', { v9Dedup: 'disabled' }, /Gotenberg 9 PDF controls/],
    ['encrypt', { userPassword: 'pass', v9Algorithm: 'aes128' }, /Gotenberg 9 PDF controls/],
  ] as const)(
    'does not forward v9-only or incompatible settings to v8 %s',
    async (id, fields, error) => {
      const remote = fixture('8.40.0', () => {
        throw new Error('Should not forward')
      })
      await assert.rejects(proxyConversionRequest(requestFor(id, fields), remote.fetcher), error)
      assert.equal(remote.count(), 0)
    },
  )

  it.each([
    [{ pdfaProfile: 'PDF/A-4f', pdfuaProfile: 'PDF/UA-1' }, /cannot be combined/],
    [{ pdfa: 'PDF/A-2b', pdfaProfile: 'PDF/A-3a' }, /either a legacy/],
    [{ pdfua: true, pdfuaProfile: 'PDF/UA-2' }, /either legacy/],
  ] as const)(
    'rejects conflicting v9 standalone PDF conformance options',
    async (fields, error) => {
      const remote = fixture('9.1.0', () => {
        throw new Error('Should not forward')
      })
      await assert.rejects(
        proxyConversionRequest(requestFor('pdfa', fields), remote.fetcher),
        error,
      )
      assert.equal(remote.count(), 0)
    },
  )

  it('accepts legacy PDF/A-1b plus PDF/UA when the selected server is v9.1', async () => {
    const remote = fixture('9.1.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'remediate', profile: ['PDF/A-1b', 'PDF/UA-1'] },
      ])
    })
    const response = await proxyConversionRequest(
      requestFor('pdfa', { pdfa: 'PDF/A-1b', pdfua: true }),
      remote.fetcher,
    )
    assert.equal(response.status, 200)
    assert.equal(remote.count(), 1)
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

  it.each(['metadata-read', 'bookmarks-read'])(
    'forwards %s PDF opening password on v9 only',
    async (id) => {
      const remote = fixture(
        '9.0.0',
        (form) => {
          assert.equal(form.get('password'), 'private-password')
          assert.equal(form.get('stages'), null)
        },
        new Response('{"report.pdf":{}}', { headers: { 'content-type': 'application/json' } }),
      )
      assert.equal(
        (
          await proxyConversionRequest(
            requestFor(id, { password: 'private-password' }),
            remote.fetcher,
          )
        ).status,
        200,
      )
      const legacy = fixture('8.40.0', () => {
        throw new Error('v8 must not receive v9 PDF password')
      })
      await assert.rejects(
        () =>
          proxyConversionRequest(requestFor(id, { password: 'private-password' }), legacy.fetcher),
        { status: 409 },
      )
      assert.equal(legacy.count(), 0)
    },
  )

  it('preserves whitespace-only PDF passwords in actual Gotenberg 9 multipart requests', async () => {
    for (const id of ['metadata-read', 'bookmarks-read'] as const) {
      const remote = fixture(
        '9.1.0',
        (form, path) => {
          assert.equal(
            path,
            id === 'metadata-read' ? '/forms/pdf/metadata' : '/forms/pdf/bookmarks',
          )
          assert.equal(form.get('password'), '   ')
        },
        new Response('"{}"', { headers: { 'content-type': 'application/json' } }),
      )
      const result = await proxyConversionRequest(
        requestFor(id, { password: '   ' }),
        remote.fetcher,
      )
      assert.equal(result.status, 200)
      assert.equal(remote.count(), 1)
    }
    const remote = fixture('9.1.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      const stage = JSON.parse(String(form.get('stages')))[0]
      assert.equal(stage.op, 'encrypt')
      assert.equal(stage.userPassword, '  ')
      assert.equal(stage.ownerPassword, '  owner  ')
    })
    const result = await proxyConversionRequest(
      requestFor('encrypt', { userPassword: '  ', ownerPassword: '  owner  ' }),
      remote.fetcher,
    )
    assert.equal(result.status, 200)
    assert.equal(remote.count(), 1)
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

  it('repairs existing Factur-X XML without an additional invoice upload', async () => {
    const remote = fixture('9.0.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'remediate', profile: 'Factur-X' },
      ])
      assert.equal(form.getAll('files').length, 1)
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('factur-x', {
            v9FacturxRepairExisting: true,
          }),
          remote.fetcher,
        )
      ).status,
      200,
    )
    assert.equal(remote.count(), 1)
  })

  it('preserves whitespace in standalone stamps and exact overlay filenames', async () => {
    const text = '  CONFIDENTIAL  '
    const remoteText = fixture('9.0.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'stamp-text', text, x: 48, y: 48, fontSize: 24 },
      ])
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('stamp', {
            stampSource: 'text',
            stampExpression: text,
            v9OverlayAcknowledged: true,
          }),
          remoteText.fetcher,
        )
      ).status,
      200,
    )

    const whitespace = fixture('9.0.0', (form) => {
      assert.equal(JSON.parse(String(form.get('stages')))[0]?.text, '   ')
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor('watermark', {
            watermarkSource: 'text',
            watermarkExpression: '   ',
            v9OverlayAcknowledged: true,
          }),
          whitespace.fetcher,
        )
      ).status,
      200,
    )

    const filename = ' logo.png'
    const remoteImage = fixture('9.0.0', (form) => {
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'stamp-image', image: filename, x: 48, y: 48, width: 0, height: 0 },
      ])
      assert.equal((form.getAll('files')[1] as File).name, filename)
    })
    assert.equal(
      (
        await proxyConversionRequest(
          requestFor(
            'stamp',
            { stampSource: 'image', stampExpression: filename, v9OverlayAcknowledged: true },
            { auxiliary: [new File(['image'], filename, { type: 'image/png' })] },
          ),
          remoteImage.fetcher,
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

  it.each([
    ['missing rolled-back count', { 'Gotenberg-Remediation-Residual': '0' }],
    ['missing residual count', { 'Gotenberg-Remediation-Rolled-Back': '0' }],
    [
      'invalid residual count',
      { 'Gotenberg-Remediation-Residual': '-1', 'Gotenberg-Remediation-Rolled-Back': '0' },
    ],
    [
      'oversized count',
      { 'Gotenberg-Remediation-Residual': '99999999999', 'Gotenberg-Remediation-Rolled-Back': '0' },
    ],
  ])(
    'marks %s as incomplete rather than silently interpreting it as zero',
    async (_, diagnostics) => {
      const remote = fixture(
        '9.0.0',
        () => {},
        new Response('%PDF-1.7\n', {
          headers: { 'Content-Type': 'application/pdf', ...diagnostics },
        }),
      )
      const response = await proxyConversionRequest(
        requestFor('pdfa', { pdfa: 'PDF/A-2b' }),
        remote.fetcher,
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Gotenui-Remediation-Incomplete'), '1')
      assert.equal(response.headers.get('Gotenberg-Remediation-Residual'), null)
      assert.equal(response.headers.get('Gotenberg-Remediation-Rolled-Back'), null)
      assert.match(await response.text(), /%PDF-/)
    },
  )

  it('forwards only bounded safe Gotenberg request correlation IDs', async () => {
    for (const trace of ['x'.repeat(129), 'unsafe trace', 'value\twith\ttabs', ':invalid-prefix']) {
      const remote = fixture(
        '9.0.0',
        () => {},
        new Response('%PDF-1.7\n', {
          headers: { 'content-type': 'application/pdf', 'gotenberg-trace': trace },
        }),
      )
      const response = await proxyConversionRequest(
        requestFor('pdfa', { pdfa: 'PDF/A-2b' }),
        remote.fetcher,
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Gotenberg-Trace'), null)
      assert.match(await response.text(), /%PDF-/)
    }
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

describe('Gotenberg 9.1 standalone PDF controls', () => {
  it.each([
    [
      'pdfa',
      ['pdfa', 'pdfua'],
      ['pdfaProfile', 'pdfuaProfile', 'v9Language', 'v9Aggressive', 'v9FigureAltText'],
    ],
    [
      'optimize',
      ['imageQuality'],
      ['v9ObjectStreams', 'v9Dedup', 'v9RecompressImages', 'v9SubsetFonts'],
    ],
    ['encrypt', [], ['v9Algorithm', 'v9PrintHighQuality']],
  ] as const)('%s displays the right version-specific controls', (id, legacy, modern) => {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    const selected = Object.fromEntries(
      [...legacy, ...modern].map((name) => [name, name === 'v9Aggressive' ? true : 'enabled']),
    )
    const v8 = activeOperationFields(operation, selected, '8.40.0')
    const v9 = activeOperationFields(operation, selected, '9.1.0')
    for (const name of legacy) {
      assert.notEqual(v8[name], undefined)
      assert.equal(v9[name], undefined)
    }
    for (const name of modern) {
      assert.equal(v8[name], undefined)
      assert.notEqual(v9[name], undefined)
    }
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

function remediationRequestFor(id: string, fields: Record<string, string | boolean>): Request {
  return requestFor(
    id,
    fields,
    id === 'merge'
      ? {
          files: [pdf(), new File(['%PDF-1.7\n'], 'second.pdf', { type: 'application/pdf' })],
        }
      : {},
  )
}

describe('Gotenberg 9 remediation parity across PDF tools', () => {
  it.each([
    [
      'merge',
      { pdfaProfile: 'PDF/A-4f', pdfuaProfile: 'PDF/UA-2' },
      [{ op: 'merge' }, { op: 'remediate', profile: ['PDF/A-4f', 'PDF/UA-2'] }],
    ],
    [
      'split',
      { splitMode: 'intervals', splitSpan: '2', pdfaProfile: 'PDF/A-3a' },
      [
        { op: 'split', every: 2 },
        { op: 'remediate', profile: 'PDF/A-3a' },
      ],
    ],
  ] as const)('accepts advanced conformance profiles in %s', async (id, fields, expected) => {
    const remote = fixture('9.1.0', (form, path) => {
      assert.equal(path, '/forms/pdf/pipe')
      assert.deepEqual(JSON.parse(String(form.get('stages'))), expected)
    })
    const result = await proxyConversionRequest(remediationRequestFor(id, fields), remote.fetcher)
    assert.equal(result.status, 200)
    assert.equal(remote.count(), 1)
  })

  it.each(['merge', 'split', 'pdfa'] as const)(
    'forwards language, aggressive repair and exact figure text in %s',
    async (id) => {
      const fields = {
        ...(id === 'split' ? { splitMode: 'intervals', splitSpan: '2' } : {}),
        pdfaProfile: 'PDF/A-2u',
        v9Language: '  de-DE  ',
        v9Aggressive: true,
        v9FigureAltText: '  Untitled figure  ',
      }
      const remote = fixture('9.1.0', (form) => {
        const stages = JSON.parse(String(form.get('stages'))) as Record<string, unknown>[]
        assert.deepEqual(stages.at(-1), {
          op: 'remediate',
          profile: 'PDF/A-2u',
          language: 'de-DE',
          aggressive: true,
          figureAltText: '  Untitled figure  ',
        })
      })
      const result = await proxyConversionRequest(remediationRequestFor(id, fields), remote.fetcher)
      assert.equal(result.status, 200)
    },
  )

  it.each([true, false])(
    'supports Factur-X remediation settings (repair existing=%s)',
    async (repair) => {
      const remote = fixture('9.1.0', (form) => {
        assert.deepEqual(JSON.parse(String(form.get('stages'))), [
          {
            op: 'remediate',
            profile: 'Factur-X',
            ...(repair ? {} : { xml: 'invoice.xml', level: 'EN 16931' }),
            language: 'fr-FR',
            aggressive: true,
            figureAltText: 'Invoice figure',
          },
        ])
      })
      const response = await proxyConversionRequest(
        requestFor(
          'factur-x',
          {
            v9FacturxRepairExisting: repair,
            v9Language: 'fr-FR',
            v9Aggressive: true,
            v9FigureAltText: 'Invoice figure',
          },
          repair ? {} : { auxiliary: [new File(['<xml/>'], 'invoice.xml')] },
        ),
        remote.fetcher,
      )
      assert.equal(response.status, 200)
    },
  )

  it.each(['merge', 'split'] as const)(
    'rejects conformance settings without a profile in %s',
    async (id) => {
      const remote = fixture('9.1.0', () => {
        throw new Error('Should not forward')
      })
      await assert.rejects(
        proxyConversionRequest(
          remediationRequestFor(id, {
            ...(id === 'split' ? { splitMode: 'intervals', splitSpan: '2' } : {}),
            v9Aggressive: true,
          }),
          remote.fetcher,
        ),
        /Choose PDF\/A or PDF\/UA/,
      )
      assert.equal(remote.count(), 0)
    },
  )

  it.each(['merge', 'split'] as const)(
    'refuses v9 profiles when forwarding to Gotenberg 8 %s',
    async (id) => {
      const remote = fixture('8.40.0', () => {
        throw new Error('Should not forward')
      })
      await assert.rejects(
        proxyConversionRequest(
          remediationRequestFor(id, {
            ...(id === 'split' ? { splitMode: 'intervals', splitSpan: '2' } : {}),
            pdfaProfile: 'PDF/A-4f',
          }),
          remote.fetcher,
        ),
        /require Gotenberg 9/,
      )
      assert.equal(remote.count(), 0)
    },
  )
})

describe('Gotenberg 9 remediation option visibility', () => {
  it.each([
    'merge',
    'split',
    'pdfa',
    'factur-x',
    'url-pdf',
    'html-pdf',
    'markdown-pdf',
    'office-pdf',
  ])('%s shows remediation fields only with Gotenberg 9', (id) => {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    const draft = {
      ...operationDefaults(operation),
      v9Language: 'en-AU',
      v9Aggressive: true,
      v9FigureAltText: 'Unlabelled image',
    }
    const v8 = activeOperationFields(operation, draft, '8.40.0')
    const v9 = activeOperationFields(operation, draft, '9.1.0')
    for (const field of ['v9Language', 'v9Aggressive', 'v9FigureAltText']) {
      assert.equal(v8[field], undefined)
      assert.equal(v9[field], draft[field as keyof typeof draft])
    }
  })
})

describe('Gotenberg 9 source PDF overlay page', () => {
  it.each(['stamp', 'watermark'] as const)('selects the source PDF page for %s', async (id) => {
    const overlay = new File(['%PDF-1.7\n'], 'overlay.pdf', { type: 'application/pdf' })
    const remote = fixture('9.1.0', (form) => {
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        {
          op: 'stamp-pdf',
          source: 'overlay.pdf',
          x: 48,
          y: 48,
          sourcePage: 3,
        },
      ])
      assert.deepEqual(
        form.getAll('files').map((file) => (file instanceof File ? file.name : '')),
        ['report.pdf', 'overlay.pdf'],
      )
    })
    const response = await proxyConversionRequest(
      requestFor(
        id,
        {
          [`${id}Source`]: 'pdf',
          [`${id}Expression`]: overlay.name,
          v9OverlayAcknowledged: true,
          v9OverlaySourcePage: '3',
        },
        { auxiliary: [overlay] },
      ),
      remote.fetcher,
    )
    assert.equal(response.status, 200)
  })

  it('rejects negative and non-integral source page numbers', async () => {
    const remote = fixture('9.1.0', () => {
      throw new Error('Should not forward')
    })
    for (const value of ['-1', '1.5']) {
      await assert.rejects(
        proxyConversionRequest(
          requestFor(
            'stamp',
            {
              stampSource: 'pdf',
              stampExpression: 'overlay.pdf',
              v9OverlayAcknowledged: true,
              v9OverlaySourcePage: value,
            },
            { auxiliary: [new File(['%PDF-1.7\n'], 'overlay.pdf')] },
          ),
          remote.fetcher,
        ),
        /range|non-negative/,
      )
    }
    assert.equal(remote.count(), 0)
  })
})
