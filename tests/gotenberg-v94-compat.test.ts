import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { parseGotenbergVersion, requiresGotenberg94ForStampPosition } from '#/lib/gotenberg-version'
import { PDF_PIPELINE_STAGES, parsePdfPipeline } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { PDF_STAMP_POSITIONS } from '#/lib/pdf-stamp-position'
import { activeOperationFields, OPERATION_BY_ID, operationDefaults } from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'
const pdf = () => new File(['%PDF-1.7\n'], 'input.pdf', { type: 'application/pdf' })
const input = (
  operation: string,
  fields: Record<string, string | boolean>,
  extra?: {
    auxiliary?: File[]
    conversionStages?: string
  },
): Request => {
  const config = OPERATION_BY_ID.get(operation)
  assert.ok(config)
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields: { ...operationDefaults(config), ...fields },
      advanced: {},
      ...(operation === 'html-pdf' ? { source: '<!doctype html><h1>Test</h1>' } : {}),
      ...(extra?.conversionStages ? { conversionStages: extra.conversionStages } : {}),
    }),
  )
  if (operation !== 'html-pdf') body.append('files', pdf())
  for (const file of extra?.auxiliary ?? []) body.append('auxiliary', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function server(version: string, onConvert: (path: string, form: FormData) => void) {
  let forwarded = 0
  const fetcher: typeof fetch = async (resource, init) => {
    if (String(resource) === `${upstream}/version`) return new Response(version)
    forwarded++
    assert.ok(init?.body instanceof FormData)
    onConvert(new URL(String(resource)).pathname, init.body)
    return new Response('%PDF-1.7\n', { headers: { 'Content-Type': 'application/pdf' } })
  }
  return { fetcher, count: () => forwarded }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9.4 stamp anchors', () => {
  it('exposes the exact upstream anchor values in both standalone tools', () => {
    assert.deepEqual(PDF_STAMP_POSITIONS, [
      'center',
      'top-left',
      'top',
      'top-right',
      'left',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
    ])
    for (const id of ['stamp', 'watermark']) {
      const config = OPERATION_BY_ID.get(id)
      assert.ok(config)
      const anchor = config.fields.find(({ name }) => name === 'v9OverlayPosition')
      assert.ok(anchor)
      assert.deepEqual(anchor.options, PDF_STAMP_POSITIONS)
      assert.deepEqual(anchor.supportedGotenbergMajors, [9])
      assert.equal(anchor.minGotenbergMinor, 4)
      const selected = { ...operationDefaults(config), v9OverlayPosition: 'bottom-right' }
      assert.equal(activeOperationFields(config, selected, '8.40.0').v9OverlayPosition, undefined)
      assert.equal(
        activeOperationFields(config, selected, '9.4.0').v9OverlayPosition,
        'bottom-right',
      )
    }
  })

  it('gates the optional anchor selector on v9.4 and lets older-version drafts be cleared', () => {
    for (const id of ['stamp', 'watermark']) {
      const anchor = OPERATION_BY_ID.get(id)?.fields.find(
        ({ name }) => name === 'v9OverlayPosition',
      )
      assert.ok(anchor)
      const render = (value: string | undefined, version: string) =>
        renderToStaticMarkup(
          createElement(FieldControl, {
            field: anchor,
            value,
            onChange: () => {},
            backendVersion: version,
          }),
        )
      const previous = render(undefined, '9.3.0')
      assert.match(previous, /<select[^>]*disabled=""/)
      assert.equal((previous.match(/<option[^>]*value="(?!")[^"]+"/g) ?? []).length, 9)
      assert.match(render('top-left', '9.3.0'), /<option value="top-left"[^>]*selected=""/)
      assert.doesNotMatch(render('top-left', '9.3.0'), /<select[^>]*disabled=""/)
      assert.doesNotMatch(render(undefined, '9.4.0'), /<select[^>]*disabled=""/)
      assert.doesNotMatch(render(undefined, '9.5.0'), /<select[^>]*disabled=""/)
    }
  })

  it('accepts all nine positions for all three pipeline stamp kinds', () => {
    for (const position of PDF_STAMP_POSITIONS) {
      for (const stage of [
        { op: 'stamp-text', text: '  DRAFT  ' },
        { op: 'stamp-image', image: 'artwork.png' },
        { op: 'stamp-pdf', source: 'overlay.pdf' },
      ]) {
        const stages = [{ ...stage, position, x: -24, y: 12, rotation: 90 }]
        assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
      }
    }
    for (const stage of PDF_PIPELINE_STAGES.filter(({ op }) => op.startsWith('stamp-'))) {
      assert.ok((stage.fields as readonly string[]).includes('position'))
      assert.match(stage.description, /9\.4\+/)
    }
  })

  it('keeps optional unanchored and null position values, rejecting wrong types and spelling', () => {
    for (const stage of [
      { op: 'stamp-text', text: 'Example' },
      { op: 'stamp-image', image: 'logo.png' },
      { op: 'stamp-pdf', source: 'cover.pdf' },
    ]) {
      for (const position of [null, '']) {
        const stages = [{ ...stage, position }]
        assert.deepEqual(parsePdfPipeline(JSON.stringify(stages)), stages)
      }
      assert.deepEqual(parsePdfPipeline(JSON.stringify([stage])), [stage])
      for (const position of ['Center', 'top-center', 'middle', ' bottom ', 12, true, {}]) {
        assert.throws(
          () => parsePdfPipeline(JSON.stringify([{ ...stage, position }])),
          /position.*must be (a string|one of)/,
        )
      }
    }
  })

  it('recognises which stamp stages require 9.4 without blocking other stages', () => {
    for (const version of ['9.0.0', '9.3.0', '9.4.0', '9.5.0', '8.40.0']) {
      const parsed = parseGotenbergVersion(version)
      assert.ok(parsed)
      const expected = parsed.major === 9 && parsed.minor < 4
      for (const op of ['stamp-text', 'stamp-image', 'stamp-pdf']) {
        assert.equal(
          requiresGotenberg94ForStampPosition(parsed, [{ op, position: 'center' }]),
          expected,
        )
        assert.equal(requiresGotenberg94ForStampPosition(parsed, [{ op, position: '' }]), false)
        assert.equal(requiresGotenberg94ForStampPosition(parsed, [{ op }]), false)
      }
      assert.equal(
        requiresGotenberg94ForStampPosition(parsed, [{ op: 'merge', position: 'center' }]),
        false,
      )
    }
  })
})

describe('Gotenberg 9.4 proxy and browser pipeline preflight', () => {
  const editor = {
    localAssetNames: [] as string[],
    archivesPresent: false,
    remoteRows: [],
    remoteJson: '',
    acknowledgedRedaction: false,
  }

  it('forwards the anchor without inventing a 48-point offset, for all standalone stamp sources', async () => {
    for (const id of ['stamp', 'watermark']) {
      for (const [source, filename, op] of [
        ['text', 'DRAFT', 'stamp-text'],
        ['image', 'artwork.png', 'stamp-image'],
        ['pdf', 'overlay.pdf', 'stamp-pdf'],
      ] as const) {
        const fields = {
          v9OverlayAcknowledged: true,
          v9OverlayPosition: 'top-right',
          [`${id}Source`]: source,
          [`${id}Expression`]: filename,
        }
        const auxiliary = source === 'text' ? [] : [new File(['overlay'], filename)]
        const remote = server('9.4.0', (path, form) => {
          assert.equal(path, '/forms/pdf/pipe')
          const stages = JSON.parse(String(form.get('stages')))
          assert.equal(stages.length, 1)
          assert.equal(stages[0]?.op, op)
          assert.equal(stages[0]?.position, 'top-right')
          assert.equal(stages[0]?.x, undefined)
          assert.equal(stages[0]?.y, undefined)
          assert.ok(form.get('files') instanceof File)
        })
        const result = await proxyConversionRequest(
          input(id, fields, { auxiliary }),
          remote.fetcher,
        )
        assert.equal(result.status, 200, `${id} ${source}: ${await result.text()}`)
        assert.equal(remote.count(), 1)
      }
    }
  })

  it('preserves explicitly entered positive, negative and zero offsets with an anchor', async () => {
    for (const [x, y] of [
      ['-12', '7.5'],
      ['0', '0'],
      ['40', '-8'],
    ]) {
      const remote = server('9.4.0', (_path, form) => {
        const [stage] = JSON.parse(String(form.get('stages')))
        assert.deepEqual(
          { position: stage.position, x: stage.x, y: stage.y },
          { position: 'bottom-left', x: Number(x), y: Number(y) },
        )
      })
      assert.equal(
        (
          await proxyConversionRequest(
            input('stamp', {
              v9OverlayAcknowledged: true,
              v9OverlayPosition: 'bottom-left',
              v9OverlayX: x,
              v9OverlayY: y,
              stampSource: 'text',
              stampExpression: 'DRAFT',
            }),
            remote.fetcher,
          )
        ).status,
        200,
      )
      assert.equal(remote.count(), 1)
    }
  })

  it('keeps unanchored 9.3 stamp defaults and explicit coordinates unchanged', async () => {
    const remote = server('9.3.0', (_path, form) => {
      assert.deepEqual(JSON.parse(String(form.get('stages'))), [
        { op: 'stamp-text', text: 'APPROVED', x: 48, y: 48, fontSize: 24 },
      ])
    })
    const result = await proxyConversionRequest(
      input('stamp', {
        v9OverlayAcknowledged: true,
        stampSource: 'text',
        stampExpression: 'APPROVED',
      }),
      remote.fetcher,
    )
    assert.equal(result.status, 200)
    assert.equal(remote.count(), 1)
  })

  it('rejects anchored standalone stamps before forwarding to a pre-9.4 upstream', async () => {
    for (const id of ['stamp', 'watermark']) {
      const remote = server('9.3.0', () => assert.fail('unsupported anchors must not be forwarded'))
      await assert.rejects(
        () =>
          proxyConversionRequest(
            input(id, {
              v9OverlayAcknowledged: true,
              v9OverlayPosition: 'center',
              [`${id}Source`]: 'text',
              [`${id}Expression`]: 'DRAFT',
            }),
            remote.fetcher,
          ),
        { name: 'InputError', status: 409, message: /Gotenberg 9\.4 or newer/ },
      )
      assert.equal(remote.count(), 0)
    }
  })

  it('gates JSON stamp positions consistently in PDF and conversion pipelines', async () => {
    const stages = JSON.stringify([{ op: 'stamp-text', text: 'DRAFT', position: 'center' }])
    assert.match(
      pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.3.0' }) ?? '',
      /9\.4/,
    )
    assert.equal(pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.4.0' }), null)
    assert.equal(pdfPipelineEditorError(stages, editor), null)
    for (const id of ['pdf-pipeline', 'html-pdf']) {
      const fields: Record<string, string | boolean> = id === 'pdf-pipeline' ? { stages } : {}
      const extra = id === 'html-pdf' ? { conversionStages: stages } : {}
      const legacy = server('9.3.0', () => assert.fail('9.3 must reject anchored stages'))
      await assert.rejects(() => proxyConversionRequest(input(id, fields, extra), legacy.fetcher), {
        name: 'InputError',
        status: 409,
        message: /9\.4 or newer/,
      })
      assert.equal(legacy.count(), 0)

      const current = server('9.4.0', (_path, form) => {
        assert.deepEqual(JSON.parse(String(form.get('stages'))), JSON.parse(stages))
      })
      const modern = await proxyConversionRequest(input(id, fields, extra), current.fetcher)
      assert.equal(modern.status, 200)
      assert.equal(current.count(), 1)
    }
  })

  it('rejects unsupported standalone anchor names without forwarding', async () => {
    const remote = server('9.4.0', () => assert.fail('invalid anchor must not be forwarded'))
    await assert.rejects(
      () =>
        proxyConversionRequest(
          input('stamp', {
            v9OverlayAcknowledged: true,
            v9OverlayPosition: 'top-center',
            stampSource: 'text',
            stampExpression: 'DRAFT',
          }),
          remote.fetcher,
        ),
      { name: 'InputError', status: 400, message: /Invalid option for Anchor position/ },
    )
    assert.equal(remote.count(), 0)
  })
})
