import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { validatePayload } from '#/lib/validation'
import {
  activeOperationFields,
  fieldSupportsBackend,
  OPERATION_BY_ID,
  operationDefaults,
} from '#/tools/registry'
import { FieldControl } from '#/tools/shared/tool-fields'

const upstream = 'http://127.0.0.1:3000'
const origin = 'https://gotenui.example.test'

function request(
  fields: Record<string, string | boolean> = {},
  advanced: Record<string, string | boolean | number> = {},
): Request {
  const form = new FormData()
  form.set('payload', JSON.stringify({ operation: 'office-pdf', fields, advanced }))
  form.append('files', new File(['Tracked changes'], 'revisions.txt'))
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': upstream },
    body: form,
  })
}

function server(version: string) {
  const sent: { path: string; form: FormData }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === `${upstream}/version`) return new Response(version)
    assert.ok(init?.body instanceof FormData)
    sent.push({ path: new URL(String(url)).pathname, form: init.body })
    return new Response('%PDF-1.7\nfixture', {
      headers: { 'Content-Type': 'application/pdf' },
    })
  }
  return { sent, fetcher }
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstream))
afterEach(() => vi.unstubAllEnvs())

describe('Gotenberg 9.10 LibreOffice tracked changes', () => {
  it('exposes an opt-in switch only for supported Office backends', () => {
    const operation = OPERATION_BY_ID.get('office-pdf')
    assert.ok(operation)
    const field = operation.fields.find(({ name }) => name === 'showTrackedChanges')
    assert.ok(field)
    assert.equal(field.kind, 'toggle')
    assert.equal(field.advanced, true)
    assert.deepEqual(field.supportedGotenbergMajors, [9])
    assert.equal(field.minGotenbergMinor, 10)
    assert.equal(operationDefaults(operation).showTrackedChanges, undefined)
    assert.equal(fieldSupportsBackend(field, '8.40.0'), false)

    const control = (version: string, value?: boolean) =>
      renderToStaticMarkup(
        createElement(FieldControl, {
          field,
          value,
          backendVersion: version,
          onChange: () => {},
        }),
      )
    assert.match(control('9.9.0'), /disabled=""/)
    assert.doesNotMatch(control('9.10.0'), /disabled=""/)
    assert.doesNotMatch(control('9.9.0', true), /disabled=""/)
    assert.deepEqual(activeOperationFields(operation, { showTrackedChanges: true }, '8.40.0'), {})
    assert.deepEqual(activeOperationFields(operation, { showTrackedChanges: false }, '9.9.0'), {})
    assert.deepEqual(activeOperationFields(operation, { showTrackedChanges: true }, '9.9.0'), {
      showTrackedChanges: true,
    })
  })

  it('forwards true and false without altering the 9.10 default or adding PDF stages', async () => {
    for (const value of [undefined, true, false] as const) {
      const backend = server('9.10.0')
      const fields: Record<string, string | boolean> =
        value === undefined ? {} : { showTrackedChanges: value }
      const response = await proxyConversionRequest(request(fields), backend.fetcher)
      assert.equal(response.status, 200)
      assert.equal(backend.sent.length, 1)
      assert.equal(backend.sent[0]?.path, '/forms/libreoffice/convert')
      assert.equal(
        backend.sent[0]?.form.get('showTrackedChanges'),
        value === undefined ? null : String(value),
      )
      assert.equal(backend.sent[0]?.form.has('stages'), false)
    }
  })

  it('rejects the option on v8 and older v9 servers before conversion', async () => {
    for (const version of ['8.40.0', '9.0.0', '9.9.0']) {
      for (const value of [true, false]) {
        const backend = server(version)
        await expect(
          proxyConversionRequest(request({ showTrackedChanges: value }), backend.fetcher),
        ).rejects.toMatchObject({ status: 409, message: /Gotenberg 9\.10 or newer/ })
        assert.equal(backend.sent.length, 0)
      }
    }
  })

  it('prevents Advanced JSON overrides and validates typed form switches', async () => {
    for (const version of ['9.9.0', '9.10.0']) {
      const backend = server(version)
      await expect(
        proxyConversionRequest(request({}, { showTrackedChanges: 'true' }), backend.fetcher),
      ).rejects.toMatchObject({ status: 400, message: /Unsupported advanced field/ })
      assert.equal(backend.sent.length, 0)
    }
    assert.throws(
      () =>
        validatePayload({
          operation: 'office-pdf',
          fields: { showTrackedChanges: 'true' },
          advanced: {},
        }),
      /Show tracked changes must be true or false/,
    )
    assert.throws(
      () =>
        validatePayload({
          operation: 'html-pdf',
          fields: {},
          advanced: { showTrackedChanges: true },
          source: '<h1>HTML</h1>',
        }),
      /not supported/,
    )
  })
})
