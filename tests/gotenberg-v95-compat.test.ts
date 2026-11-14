import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { parseGotenbergVersion, requiresGotenberg95ForPaperSize } from '#/lib/gotenberg-version'
import { PDF_PAPER_SIZES } from '#/lib/pdf-paper-sizes'
import { PDF_PIPELINE_STAGES, parsePdfPipeline } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import { InputError } from '#/lib/validation'
import { OPERATION_BY_ID, operationDefaults } from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'

const origin = 'https://gotenui.example.test'
const upstream = 'http://127.0.0.1:3000'
const pdf = () => new File(['%PDF-1.7\nfixture'], 'source.pdf', { type: 'application/pdf' })

function request(
  operation: string,
  fields: Record<string, string | boolean> = {},
  conversionStages?: string,
): Request {
  const config = OPERATION_BY_ID.get(operation)
  assert.ok(config, operation)
  const body = new FormData()
  body.set(
    'payload',
    JSON.stringify({
      operation,
      fields: { ...operationDefaults(config), ...fields },
      advanced: {},
      ...(operation === 'html-pdf' ? { source: '<!doctype html><h1>Example</h1>' } : {}),
      ...(conversionStages ? { conversionStages } : {}),
    }),
  )
  if (operation === 'office-pdf') body.append('files', new File(['text'], 'source.txt'))
  if (config.input === 'pdf') body.append('files', pdf())
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body,
  })
}

function server(
  version: string,
  onConvert: (path: string, form: FormData) => void,
  response: () => Response = () =>
    new Response('%PDF-1.7\nGenerated PDF', { headers: { 'Content-Type': 'application/pdf' } }),
) {
  let forwarded = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    forwarded++
    assert.ok(init?.body instanceof FormData)
    onConvert(new URL(String(url)).pathname, init.body)
    return response()
  }
  return { fetcher, count: () => forwarded }
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

describe('Gotenberg 9.5 paper sizes', () => {
  it('exposes all upstream sizes in Chromium, Office and PDF Compose', () => {
    assert.deepEqual(PDF_PAPER_SIZES, [
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'B4',
      'B5',
      'Letter',
      'Legal',
      'Tabloid',
    ])
    for (const id of ['html-pdf', 'url-pdf', 'markdown-pdf', 'office-pdf', 'compose-pages']) {
      const field = OPERATION_BY_ID.get(id)?.fields.find(({ name }) => name === 'paperSize')
      assert.ok(field, id)
      assert.deepEqual(field.options, PDF_PAPER_SIZES)
      const render = (version: string, value = '') =>
        renderToStaticMarkup(
          createElement(FieldControl, {
            field,
            value,
            backendVersion: version,
            onChange: () => {},
          }),
        )
      for (const version of ['9.2.0', '9.4.1']) {
        const markup = render(version)
        for (const size of ['A0', 'A1', 'A2']) {
          assert.match(markup, new RegExp(`<option value="${size}" disabled=""`))
        }
        assert.match(markup, /<option value="A4"/)
        assert.doesNotMatch(markup, /<option value="A4" disabled=""/)
        // A previously selected size can still be changed after switching connections.
        assert.doesNotMatch(render(version, 'A0'), /<select[^>]*disabled=""/)
      }
      for (const size of ['A0', 'A1', 'A2']) {
        assert.doesNotMatch(render('9.5.0'), new RegExp(`<option value="${size}" disabled=""`))
      }
    }
    assert.match(
      PDF_PIPELINE_STAGES.find(({ op }) => op === 'compose')?.description ?? '',
      /9\.5\+/,
    )
  })

  it('parses the new sizes in composition, but still rejects unsupported sizes', () => {
    for (const name of ['A0', 'A1', 'A2', 'a0', 'a1', 'a2']) {
      const stage = [{ op: 'compose', paperSize: name, placements: [{}] }]
      assert.deepEqual(parsePdfPipeline(JSON.stringify(stage)), stage)
    }
    assert.throws(
      () => parsePdfPipeline('[{"op":"compose","paperSize":"A7","placements":[{}]}]'),
      /unsupported paperSize/,
    )
  })

  it('checks version applicability without affecting smaller paper sizes or other majors', () => {
    for (const version of ['8.40.0', '9.4.1', '9.5.0', '9.6.0']) {
      const parsed = parseGotenbergVersion(version)
      assert.ok(parsed)
      const requiresUpgrade = parsed.major === 9 && parsed.minor < 5
      for (const size of ['A0', 'A1', 'A2', 'a0', 'a1', 'a2']) {
        assert.equal(requiresGotenberg95ForPaperSize(parsed, [size]), requiresUpgrade)
      }
      assert.equal(requiresGotenberg95ForPaperSize(parsed, ['A3', 'A4', undefined]), false)
    }
  })

  it('rejects large named sizes before forwarding them on Gotenberg 9.4 and earlier', async () => {
    for (const version of ['9.2.0', '9.4.1']) {
      for (const id of ['html-pdf', 'office-pdf', 'compose-pages']) {
        for (const size of ['A0', 'A1', 'A2']) {
          const remote = server(version, () => assert.fail('Unsupported paper size was forwarded'))
          await assert.rejects(
            proxyConversionRequest(request(id, { paperSize: size }), remote.fetcher),
            (error: unknown) =>
              error instanceof InputError &&
              error.status === 409 &&
              /A0, A1 and A2.*9\.5/.test(error.message),
          )
          assert.equal(remote.count(), 0, `${version} ${id} ${size}`)
        }
      }
    }
  })

  it('forwards new paper sizes to Gotenberg 9.5 across conversion and compose routes', async () => {
    for (const id of ['html-pdf', 'office-pdf', 'compose-pages']) {
      for (const size of ['A0', 'A1', 'A2']) {
        const remote = server('9.5.0', (path, form) => {
          assert.equal(form.get('paperSize'), size)
          assert.equal(
            path,
            id === 'html-pdf'
              ? '/forms/chromium/convert/html'
              : id === 'office-pdf'
                ? '/forms/libreoffice/convert'
                : '/forms/pdf/compose',
          )
        })
        const response = await proxyConversionRequest(
          request(id, { paperSize: size }),
          remote.fetcher,
        )
        assert.equal(response.status, 200, `${id} ${size}`)
        assert.equal(remote.count(), 1)
      }
    }
  })

  it('rejects unsupported PDF and conversion compose stages in both server and editor preflight', async () => {
    const stages = JSON.stringify([
      { op: 'compose', paperSize: 'A1', placements: [{ sourcePage: 1, page: 1 }] },
    ])
    assert.match(
      pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.4.1' }) ?? '',
      /9\.5/,
    )
    assert.equal(pdfPipelineEditorError(stages, { ...editor, backendVersion: '9.5.0' }), null)
    for (const id of ['pdf-pipeline', 'html-pdf', 'office-pdf']) {
      for (const version of ['9.2.0', '9.4.1']) {
        const remote = server(version, () => assert.fail('Unsupported pipeline was forwarded'))
        await assert.rejects(
          proxyConversionRequest(
            request(
              id,
              id === 'pdf-pipeline' ? { stages } : {},
              id === 'pdf-pipeline' ? undefined : stages,
            ),
            remote.fetcher,
          ),
          (error: unknown) =>
            error instanceof InputError && error.status === 409 && /9\.5/.test(error.message),
        )
        assert.equal(remote.count(), 0)
      }
      const remote = server('9.5.0', (_path, form) => {
        const stagesSent = JSON.parse(String(form.get('stages')))
        assert.equal(
          stagesSent.find((stage: { op: string }) => stage.op === 'compose')?.paperSize,
          'A1',
        )
      })
      const accepted = await proxyConversionRequest(
        request(
          id,
          id === 'pdf-pipeline' ? { stages } : {},
          id === 'pdf-pipeline' ? undefined : stages,
        ),
        remote.fetcher,
      )
      assert.equal(accepted.status, 200)
      assert.equal(remote.count(), 1)
    }
  })
})

describe('Gotenberg 9.5 PDF information signature flag', () => {
  it('preserves signed true, false and missing values without claiming signature verification', async () => {
    const operation = OPERATION_BY_ID.get('pdf-info')
    assert.ok(operation)
    assert.match(operation.summary, /not validity/)
    for (const [version, signed] of [
      ['9.5.0', true],
      ['9.5.0', false],
      ['9.4.1', undefined],
    ] as const) {
      const data = {
        'source.pdf': {
          pages: 1,
          encrypted: false,
          ...(signed === undefined ? {} : { signed }),
        },
      }
      const remote = server(
        version,
        (path) => assert.equal(path, '/forms/pdf/info'),
        () => Response.json(data),
      )
      const response = await proxyConversionRequest(request('pdf-info'), remote.fetcher)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), data)
      assert.equal(remote.count(), 1)
    }
  })
})
