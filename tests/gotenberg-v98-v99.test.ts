import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import {
  parseGotenbergVersion,
  requiresGotenberg98ForExtractTextFormat,
  requiresGotenberg99ForCompressStreams,
} from '#/lib/gotenberg-version'
import { PDF_PIPELINE_STAGES, parsePdfPipeline, pipelineResponseTypes } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { responseExtension } from '#/lib/security'
import type { ConversionPayload } from '#/lib/validation'
import { activeOperationFields, OPERATION_BY_ID, operationDefaults } from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'

const upstream = 'http://127.0.0.1:3000'
const origin = 'https://gotenui.example.test'

function request(
  operationId: string,
  fields: Record<string, string | boolean> = {},
  conversionStages?: unknown[],
): Request {
  const operation = OPERATION_BY_ID.get(operationId)
  assert.ok(operation, operationId)
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation: operationId,
      fields: { ...operationDefaults(operation), ...fields },
      advanced: {},
      ...(operationId === 'html-pdf' ? { source: '<h1>Markdown conversion</h1>' } : {}),
      ...(conversionStages ? { conversionStages: JSON.stringify(conversionStages) } : {}),
    } satisfies ConversionPayload),
  )
  if (operation.input === 'pdf') {
    body.append('files', new File(['%PDF-1.7\nfixture'], 'report.pdf', { type: 'application/pdf' }))
  }
  if (operationId === 'office-pdf') body.append('files', new File(['test'], 'document.txt'))
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function server(version: string, contentType = 'application/pdf') {
  const requests: { path: string; form: FormData; stages: Record<string, unknown>[] }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    assert.ok(init?.body instanceof FormData)
    requests.push({
      path: new URL(String(url)).pathname,
      form: init.body,
      stages: JSON.parse(String(init.body.get('stages') ?? '[]')),
    })
    return new Response(
      contentType === 'text/markdown'
        ? '# Test heading\n\nText paragraph\n'
        : contentType === 'application/zip'
          ? new Uint8Array([0x50, 0x4b, 0x05, 0x06])
          : '%PDF-1.7\nfixture',
      { headers: { 'Content-Type': contentType } },
    )
  }
  return { requests, fetcher }
}

async function convert(
  operationId: string,
  version: string,
  fields: Record<string, string | boolean> = {},
  conversionStages?: unknown[],
  contentType = 'application/pdf',
) {
  const upstreamServer = server(version, contentType)
  const response = await proxyConversionRequest(
    request(operationId, fields, conversionStages),
    upstreamServer.fetcher,
  )
  return { response, requests: upstreamServer.requests }
}

const editor = {
  localAssetNames: [] as string[],
  archivesPresent: false,
  remoteRows: [],
  remoteJson: '',
  acknowledgedRedaction: false,
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9.8 Markdown text extraction', () => {
  it('exposes a version-gated standalone format selector without changing the default', () => {
    const operation = OPERATION_BY_ID.get('extract-text')
    assert.ok(operation)
    const field = operation.fields.find(({ name }) => name === 'format')
    assert.ok(field)
    assert.equal(field.minGotenbergMinor, 8)
    assert.deepEqual(field.options, ['text', 'markdown'])
    assert.equal(operationDefaults(operation).format, undefined)
    const html = (version: string, value = '') =>
      renderToStaticMarkup(
        createElement(FieldControl, { field, value, backendVersion: version, onChange: () => {} }),
      )
    assert.match(html('9.7.0'), /<select[^>]*disabled=""/)
    assert.doesNotMatch(html('9.8.0'), /<select[^>]*disabled=""/)
    // Existing selections remain editable after switching to an older backend.
    assert.doesNotMatch(html('9.7.0', 'markdown'), /<select[^>]*disabled=""/)
    assert.deepEqual(activeOperationFields(operation, { format: 'markdown' }, '9.7.0'), {})
    assert.deepEqual(activeOperationFields(operation, { format: '' }, '9.7.0'), {})
  })

  it('validates extract-text format without affecting render formats or plain text output', () => {
    for (const format of ['', 'text', 'markdown']) {
      const stage = { op: 'extract-text', format }
      assert.deepEqual(parsePdfPipeline(JSON.stringify([stage])), [stage])
    }
    for (const format of ['html', 'pdf', 'png', 'MARKDOWN', 2]) {
      assert.throws(
        () => parsePdfPipeline(JSON.stringify([{ op: 'extract-text', format }])),
        /format|must be a string/,
      )
    }
    assert.deepEqual(pipelineResponseTypes([{ op: 'extract-text', format: 'markdown' }]), [
      'text/markdown',
      'application/zip',
    ])
    assert.deepEqual(pipelineResponseTypes([{ op: 'extract-text' }]), [
      'text/plain',
      'application/zip',
    ])
    assert.deepEqual(
      pipelineResponseTypes([{ op: 'optimize' }, { op: 'extract-text', format: 'markdown' }]),
      ['application/zip'],
    )
    assert.equal(responseExtension('text/markdown; charset=utf-8'), 'md')
    assert.deepEqual(parsePdfPipeline('[{"op":"render","format":"png"}]'), [
      { op: 'render', format: 'png' },
    ])
  })

  it('rejects explicit formats on older servers but keeps their default extraction', async () => {
    const old = server('9.7.0', 'text/markdown')
    await expect(
      proxyConversionRequest(request('extract-text', { format: 'markdown' }), old.fetcher),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      proxyConversionRequest(
        request('pdf-pipeline', { stages: '[{"op":"extract-text","format":"text"}]' }),
        old.fetcher,
      ),
    ).rejects.toMatchObject({ status: 409 })
    assert.equal(old.requests.length, 0)
    const legacy = await convert('extract-text', '9.7.0', {}, undefined, 'text/plain')
    assert.equal(legacy.response.status, 200)
    assert.equal(legacy.requests[0]?.form.has('format'), false)
  })

  it('forwards standalone Markdown and returns the correct content type and file extension', async () => {
    const { response, requests } = await convert(
      'extract-text',
      '9.8.0',
      { format: 'markdown' },
      undefined,
      'text/markdown',
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/markdown')
    assert.match(response.headers.get('content-disposition') ?? '', /\.md/i)
    assert.equal(await response.text(), '# Test heading\n\nText paragraph\n')
    assert.equal(requests[0]?.path, '/forms/pdf/extract-text')
    assert.equal(requests[0]?.form.get('format'), 'markdown')
    // No permissive fallback to HTML or other unrequested media types.
    const bad = server('9.8.0', 'text/html')
    await expect(
      proxyConversionRequest(request('extract-text', { format: 'markdown' }), bad.fetcher),
    ).rejects.toMatchObject({ status: 502 })
  })

  it('forwards Markdown in PDF and conversion pipelines with the correct ZIP contract', async () => {
    const stages = [{ op: 'extract-text', format: 'markdown' }]
    const pdf = await convert(
      'pdf-pipeline',
      '9.8.0',
      { stages: JSON.stringify(stages) },
      undefined,
      'text/markdown',
    )
    assert.equal(pdf.response.status, 200)
    assert.deepEqual(pdf.requests[0]?.stages, stages)
    const conversion = await convert('html-pdf', '9.8.0', {}, stages, 'application/zip')
    assert.equal(conversion.response.status, 200)
    assert.deepEqual(conversion.requests[0]?.stages, stages)
    assert.equal(conversion.requests[0]?.path, '/forms/chromium/convert/html')
  })
})

describe('Gotenberg 9.9 LibreOffice locale', () => {
  it('displays the locale only for v9, with a 9.9+ UI gate', () => {
    const operation = OPERATION_BY_ID.get('office-pdf')
    assert.ok(operation)
    const field = operation.fields.find(({ name }) => name === 'locale')
    assert.ok(field)
    assert.deepEqual(field.supportedGotenbergMajors, [9])
    assert.equal(field.minGotenbergMinor, 9)
    const html = (version: string, value = '') =>
      renderToStaticMarkup(
        createElement(FieldControl, { field, value, backendVersion: version, onChange: () => {} }),
      )
    assert.match(html('9.8.0'), /disabled=""/)
    assert.doesNotMatch(html('9.9.0'), /disabled=""/)
    assert.equal(operationDefaults(operation).locale, undefined)
    assert.deepEqual(activeOperationFields(operation, { locale: 'en-AU' }, '8.40.0'), {})
  })

  it('accepts upstream BCP 47 tags and preserves them in the LibreOffice multipart body', async () => {
    for (const locale of ['en-AU', 'de-DE', 'fr', 'es-419', 'zh-Hans-CN']) {
      const { response, requests } = await convert('office-pdf', '9.9.0', { locale })
      assert.equal(response.status, 200)
      assert.equal(requests[0]?.form.get('locale'), locale)
      assert.equal(requests[0]?.path, '/forms/libreoffice/convert')
    }
    const unchanged = await convert('office-pdf', '9.8.0')
    assert.equal(unchanged.response.status, 200)
    assert.equal(unchanged.requests[0]?.form.has('locale'), false)
  })

  it('rejects unsupported versions and malformed locales before forwarding', async () => {
    for (const version of ['8.40.0', '9.8.0']) {
      const old = server(version)
      await expect(
        proxyConversionRequest(request('office-pdf', { locale: 'en-AU' }), old.fetcher),
      ).rejects.toMatchObject({ status: 409 })
      assert.equal(old.requests.length, 0)
    }
    for (const locale of ['en_US', 'en-AU,foo', 'en-AU\n', 'en-Latn-AU-extra', 'x']) {
      const invalid = server('9.9.0')
      await expect(
        proxyConversionRequest(request('office-pdf', { locale }), invalid.fetcher),
      ).rejects.toThrow(/locale.*BCP 47/i)
      assert.equal(invalid.requests.length, 0)
    }
  })
})

describe('Gotenberg 9.9 stream compression', () => {
  it('exposes the new standalone option and validates boolean stage values', () => {
    const operation = OPERATION_BY_ID.get('optimize')
    assert.ok(operation)
    const field = operation.fields.find(({ name }) => name === 'v9CompressStreams')
    assert.ok(field)
    assert.equal(field.minGotenbergMinor, 9)
    assert.deepEqual(field.options, ['enabled', 'disabled'])
    assert.equal(operationDefaults(operation).v9CompressStreams, undefined)
    const stage = PDF_PIPELINE_STAGES.find(({ op }) => op === 'optimize')
    assert.ok((stage?.fields as readonly string[] | undefined)?.includes('compressStreams'))
    for (const compressStreams of [true, false]) {
      assert.deepEqual(parsePdfPipeline(JSON.stringify([{ op: 'optimize', compressStreams }])), [
        { op: 'optimize', compressStreams },
      ])
    }
    assert.throws(
      () => parsePdfPipeline('[{"op":"optimize","compressStreams":"false"}]'),
      /compressStreams.*true or false/,
    )
  })

  it('checks the Gotenberg 9.8/9.9 feature boundaries in both pipeline editors', () => {
    const stages = '[{"op":"optimize","compressStreams":false}]'
    assert.match(
      pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.8.0' }) ?? '',
      /9\.9/,
    )
    assert.equal(pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.9.0' }), null)
    const markdown = '[{"op":"extract-text","format":"markdown"}]'
    assert.match(
      pdfPipelineEditorError(markdown, { ...editor, backendVersion: '9.7.0' }) ?? '',
      /9\.8/,
    )
    assert.equal(pdfPipelineEditorError(markdown, { ...editor, backendVersion: '9.8.0' }), null)
    for (const [version, formatRequired, compressRequired] of [
      ['9.7.0', true, true],
      ['9.8.0', false, true],
      ['9.9.0', false, false],
      ['8.40.0', false, false],
    ] as const) {
      const parsed = parseGotenbergVersion(version)
      assert.ok(parsed)
      assert.equal(
        requiresGotenberg98ForExtractTextFormat(parsed, [{ op: 'extract-text', format: '' }]),
        formatRequired,
      )
      assert.equal(
        requiresGotenberg99ForCompressStreams(parsed, [{ op: 'optimize', compressStreams: false }]),
        compressRequired,
      )
      assert.equal(requiresGotenberg98ForExtractTextFormat(parsed, [{ op: 'extract-text' }]), false)
      assert.equal(requiresGotenberg99ForCompressStreams(parsed, [{ op: 'optimize' }]), false)
    }
  })

  it('serializes both enabled and disabled values but omits unset defaults', async () => {
    for (const [selected, expected] of [
      ['enabled', true],
      ['disabled', false],
    ] as const) {
      const { response, requests } = await convert('optimize', '9.9.0', {
        v9CompressStreams: selected,
      })
      assert.equal(response.status, 200)
      assert.equal(requests[0]?.stages[0]?.compressStreams, expected)
    }
    const defaults = await convert('optimize', '9.8.0')
    assert.equal(defaults.response.status, 200)
    assert.equal(defaults.requests[0]?.stages[0]?.compressStreams, undefined)
  })

  it('rejects compression options on older servers and forwards pipeline values on 9.9', async () => {
    const old = server('9.8.0')
    await expect(
      proxyConversionRequest(request('optimize', { v9CompressStreams: 'disabled' }), old.fetcher),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      proxyConversionRequest(
        request('pdf-pipeline', { stages: '[{"op":"optimize","compressStreams":false}]' }),
        old.fetcher,
      ),
    ).rejects.toMatchObject({ status: 409 })
    assert.equal(old.requests.length, 0)
    const newest = await convert('pdf-pipeline', '9.9.0', {
      stages: '[{"op":"optimize","compressStreams":false}]',
    })
    assert.equal(newest.response.status, 200)
    assert.equal(newest.requests[0]?.stages[0]?.compressStreams, false)
  })
})
