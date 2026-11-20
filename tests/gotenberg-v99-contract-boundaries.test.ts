import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { FieldControl } from '#/components/gotenui-app'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { proxyConversionRequest } from '#/lib/gotenberg-proxy.server'
import { OPERATION_BY_ID } from '#/lib/operations'
import { validatePayload } from '#/lib/validation'

function request(
  operation: string,
  fields: Record<string, string | boolean>,
  downloadFrom?: Array<{ url: string; name?: string; filename?: string }>,
) {
  return { operation, fields, advanced: {}, ...(downloadFrom ? { downloadFrom } : {}) }
}

test('Gotenberg screenshot integer fields refuse fractional values before forwarding', () => {
  for (const operation of ['url-shot', 'html-shot', 'markdown-shot']) {
    const base = {
      format: 'jpeg',
      ...(operation === 'url-shot' ? { url: 'https://example.test/' } : {}),
    }
    for (const name of ['width', 'height', 'quality']) {
      assert.throws(
        () =>
          validatePayload({
            ...request(operation, { ...base, [name]: '48.5' }),
            ...(operation === 'url-shot' ? {} : { source: '<p>Hello</p>' }),
          }),
        /outside its permitted range|integer/i,
        `${operation} ${name}`,
      )
      const field = OPERATION_BY_ID.get(operation)?.fields.find(({ name: key }) => key === name)
      assert.ok(field)
      const markup = renderToStaticMarkup(
        createElement(FieldControl, {
          field,
          value: '80',
          onChange: () => {},
          backendVersion: '9.9.0',
        }),
      )
      assert.match(markup, /step="1"/, `${operation} ${name} must use whole-number UI step`)
    }
  }
})

test('Numeric form fields only accept Go-compatible decimal spellings', () => {
  const good = ['2', '002', '+2']
  for (const raw of good) {
    assert.doesNotThrow(() => validatePayload(request('office-pdf', { initialPage: raw })))
  }
  for (const raw of ['0x2', '1e1', ' 2 ', '2.0', '9223372036854775808']) {
    assert.throws(
      () => validatePayload(request('office-pdf', { initialPage: raw })),
      /outside its permitted range|integer/i,
      `Go strconv.Atoi rejects ${JSON.stringify(raw)}`,
    )
  }
  for (const raw of ['0x2', ' 1.5 ']) {
    assert.throws(
      () =>
        validatePayload(
          request('url-shot', { url: 'https://example.test', deviceScaleFactor: raw }),
        ),
      /outside its permitted range|number/i,
      `Go strconv.ParseFloat rejects ${JSON.stringify(raw)}`,
    )
  }
  for (const raw of ['1.5', '1e0', '+1.']) {
    assert.doesNotThrow(() =>
      validatePayload(request('url-shot', { url: 'https://example.test', deviceScaleFactor: raw })),
    )
  }
})

test('Gotenberg 9 remote filename overrides reject whitespace-only names', () => {
  const remoteUrl = 'https://files.example.test/report.pdf'
  for (const key of ['name', 'filename'] as const) {
    for (const invalidName of ['   ', ' \u0085 ']) {
      assert.throws(
        () => validatePayload(request('office-pdf', {}, [{ url: remoteUrl, [key]: invalidName }])),
        /filename|name/i,
        key,
      )
    }
  }
  for (const key of ['name', 'filename'] as const) {
    const { payload, operation } = validatePayload(
      request('office-pdf', {}, [{ url: remoteUrl, [key]: ' report.pdf ' }]),
    )
    const form = createGotenbergForm(operation, payload, [], [], undefined, {}, [], 9, {
      major: 9,
      minor: 9,
      patch: 0,
    })
    assert.equal(JSON.parse(String(form.get('downloadFrom')))[0].filename, ' report.pdf ')
  }
  // An empty override is omitted by the adapter, and Go permits the U+FEFF
  // filename because its TrimSpace implementation does not classify BOM as space.
  for (const key of ['name', 'filename'] as const) {
    const { payload, operation } = validatePayload(
      request('office-pdf', {}, [{ url: remoteUrl, [key]: '' }]),
    )
    const form = createGotenbergForm(operation, payload, [], [], undefined, {}, [], 9, {
      major: 9,
      minor: 9,
      patch: 0,
    })
    assert.equal(JSON.parse(String(form.get('downloadFrom')))[0].filename, undefined)
  }
  assert.doesNotThrow(() =>
    validatePayload(request('office-pdf', {}, [{ url: remoteUrl, filename: '\uFEFF' }])),
  )
  const { payload, operation } = validatePayload(
    request('office-pdf', {}, [{ url: remoteUrl, name: 'report.pdf', filename: '' }]),
  )
  const form = createGotenbergForm(operation, payload, [], [], undefined, {}, [], 9, {
    major: 9,
    minor: 9,
    patch: 0,
  })
  assert.equal(JSON.parse(String(form.get('downloadFrom')))[0].filename, 'report.pdf')
})

test('proxy rejects unsupported numeric spelling and blank remote names before fetching upstream', async () => {
  const cases = [
    request('url-shot', { url: 'https://example.test/', width: '48.5' }),
    request('office-pdf', { initialPage: '0x2' }),
    request('office-pdf', {}, [{ url: 'https://files.example.test/doc.pdf', filename: '   ' }]),
  ]
  let outgoingRequests = 0
  const fetcher: typeof fetch = async () => {
    outgoingRequests++
    throw new Error('Invalid user input must never reach upstream.')
  }
  for (const payload of cases) {
    const body = new FormData()
    body.set('payload', JSON.stringify(payload))
    const incoming = new Request('https://gotenui.example.test/api/gotenberg/convert', {
      method: 'POST',
      headers: { Origin: 'https://gotenui.example.test' },
      body,
    })
    await assert.rejects(proxyConversionRequest(incoming, fetcher), { name: 'InputError' })
  }
  assert.equal(outgoingRequests, 0)
})
