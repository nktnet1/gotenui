import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  type ChromiumCookie,
  type ChromiumResourceHeader,
  chromiumNetworkFields,
} from '#/lib/chromium-network'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { validatePayload } from '#/lib/validation'

function request(operation: string, extra: Record<string, string | boolean> = {}) {
  const definition = OPERATION_BY_ID.get(operation)
  assert.ok(definition)
  return {
    operation,
    fields: {
      ...operationDefaults(definition),
      ...extra,
      ...(definition.input === 'url' ? { url: 'https://example.test' } : {}),
    },
    advanced: {},
    ...(definition.input === 'html'
      ? { source: '<!doctype html><html><body>Test</body></html>' }
      : {}),
    ...(definition.input === 'markdown' ? { source: '# Test' } : {}),
  }
}

const cookie: ChromiumCookie = {
  name: 'session_id',
  value: 'opaque=secret',
  domain: 'portal.example.test',
  path: '/private',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
}
const header: ChromiumResourceHeader = {
  name: 'Authorization',
  value: 'Bearer private-token',
  scope: '^https://portal\\.example\\.test/',
}

test('Chromium PDF controls are not accidentally exposed to screenshot or Office routes', () => {
  for (const id of ['url-pdf', 'html-pdf', 'markdown-pdf']) {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    for (const key of [
      'singlePage',
      'preferCssPageSize',
      'generateTaggedPdf',
      'generateDocumentOutline',
      'waitForSelector',
      'cookies',
      'extraHttpHeaders',
    ]) {
      assert.ok(
        operation.fields.some((field) => field.name === key),
        `${id}: ${key}`,
      )
    }
  }
  for (const id of ['url-shot', 'html-shot', 'markdown-shot']) {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    for (const key of ['waitForSelector', 'waitForExpression', 'cookies', 'extraHttpHeaders']) {
      assert.ok(
        operation.fields.some((field) => field.name === key),
        `${id}: ${key}`,
      )
    }
    for (const key of [
      'singlePage',
      'generateTaggedPdf',
      'generateDocumentOutline',
      'preferCssPageSize',
    ]) {
      assert.ok(!operation.fields.some((field) => field.name === key))
    }
  }
  const office = OPERATION_BY_ID.get('office-pdf')
  assert.ok(office)
  assert.ok(office.fields.some((field) => field.name === 'password' && field.kind === 'password'))
  assert.ok(!office.fields.some((field) => field.name === 'cookies'))
})

test('the request editor serializes Chromium cookies and scoped headers as JSON form fields only', () => {
  const settings = chromiumNetworkFields([cookie], [header])
  assert.deepEqual(JSON.parse(settings.cookies), [cookie])
  assert.deepEqual(JSON.parse(settings.extraHttpHeaders), {
    Authorization: 'Bearer private-token;scope=^https://portal\\.example\\.test/',
  })
  for (const id of ['url-pdf', 'html-shot', 'markdown-pdf']) {
    const validated = validatePayload(
      request(id, {
        ...settings,
        waitForSelector: '#app-ready',
        waitForExpression: 'window.ready === true',
      }),
    )
    const multipart = createGotenbergForm(validated.operation, validated.payload, [], [])
    assert.equal(multipart.get('cookies'), settings.cookies)
    assert.equal(multipart.get('extraHttpHeaders'), settings.extraHttpHeaders)
    assert.equal(multipart.get('waitForSelector'), '#app-ready')
    assert.equal(multipart.get('waitForExpression'), 'window.ready === true')
    assert.equal(multipart.has('Authorization'), false)
  }
  assert.deepEqual(chromiumNetworkFields([], []), {})
  assert.throws(
    () => chromiumNetworkFields([], [header, { ...header, name: 'authorization' }]),
    /Duplicate Chromium header/,
  )
})

test('validates cookie domains, types, boundaries and security attributes', () => {
  const valid = request('url-pdf', { cookies: JSON.stringify([cookie]) })
  assert.doesNotThrow(() => validatePayload(valid))
  for (const bad of [
    { ...cookie, domain: 'https://portal.example.test/private' },
    { ...cookie, name: 'bad;name' },
    { ...cookie, value: 'abc\r\nSet-Cookie: injected=true' },
    { ...cookie, sameSite: 'None', secure: false },
    { ...cookie, unexpected: true },
    { ...cookie, secure: 'true' },
  ]) {
    assert.throws(
      () => validatePayload(request('url-pdf', { cookies: JSON.stringify([bad]) })),
      /cookie/i,
    )
  }
  for (const bad of ['{}', '[]', '{', JSON.stringify(Array(21).fill(cookie))]) {
    assert.throws(() => validatePayload(request('url-pdf', { cookies: bad })), /cookie/i)
  }
})

test('rejects secret browser headers without a scope, unsafe header names and malformed scoped headers', () => {
  for (const fields of [
    { Authorization: 'Bearer secret' },
    { 'X-Api-Key': 'secret' },
    { Host: 'private.example.test' },
    { 'Set-Cookie': 'a=b' },
    { 'X-Safe': 'secret\r\nCookie: a=b' },
    { Authorization: 'Bearer secret;scope=' },
    { Authorization: 'Bearer secret;scope=^https://[broken' },
    { Authorization: 'Bearer secret;scope=^https://a\\.test/;scope=^https://b\\.test/' },
    { Authorization: `Bearer secret;scope=${'a'.repeat(257)}` },
  ]) {
    assert.throws(
      () => validatePayload(request('url-pdf', { extraHttpHeaders: JSON.stringify(fields) })),
      /header|scope/i,
    )
  }
  assert.throws(
    () =>
      validatePayload(
        request('url-pdf', {
          extraHttpHeaders: JSON.stringify({
            Authorization: 'Bearer secret',
            authorization: 'Bearer other',
          }),
        }),
      ),
    /header/i,
  )
  assert.doesNotThrow(() =>
    validatePayload(
      request('url-pdf', { extraHttpHeaders: JSON.stringify({ 'X-Public-Header': 'public' }) }),
    ),
  )
})

test('validates Chromium typed printing, waiting and tag/outline controls', () => {
  const validated = validatePayload(
    request('url-pdf', {
      singlePage: true,
      preferCssPageSize: true,
      generateTaggedPdf: true,
      generateDocumentOutline: true,
      waitForSelector: '#loaded',
    }),
  )
  const form = createGotenbergForm(validated.operation, validated.payload, [], [])
  assert.equal(form.get('singlePage'), 'true')
  assert.equal(form.get('preferCssPageSize'), 'true')
  assert.equal(form.get('generateTaggedPdf'), 'true')
  assert.equal(form.get('generateDocumentOutline'), 'true')
  assert.equal(form.get('waitForSelector'), '#loaded')
  assert.throws(
    () => validatePayload(request('url-pdf', { waitForSelector: '  ' })),
    /waitForSelector/,
  )
  assert.throws(
    () => validatePayload(request('url-pdf', { userAgent: 'client\r\nHeader: secret' })),
    /userAgent/,
  )
  for (const advanced of [{ singlePage: true }, { cookies: '[]' }]) {
    assert.throws(() => validatePayload({ ...request('office-pdf'), advanced }), /not supported/)
  }
  assert.throws(
    () => validatePayload({ ...request('url-shot'), advanced: { generateTaggedPdf: true } }),
    /not supported/,
  )
})

test('LibreOffice native source password stays separate from output PDF encryption', () => {
  const password = 'source-only-password'
  const validated = validatePayload(
    request('office-pdf', {
      password,
      exportNotesPages: true,
      exportOnlyNotesPages: true,
      exportHiddenSlides: true,
      initialView: '1',
      initialPage: '3',
      magnification: '4',
      zoom: '125',
      pageLayout: '3',
      firstPageOnLeft: true,
    }),
  )
  const file = new File(['Office test'], 'test.txt', { type: 'text/plain' })
  const form = createGotenbergForm(validated.operation, validated.payload, [file], [])
  assert.equal(form.get('password'), password)
  assert.equal(form.has('userPassword'), false)
  assert.equal(form.has('ownerPassword'), false)
  assert.equal(form.get('exportOnlyNotesPages'), 'true')
  assert.equal(form.get('zoom'), '125')
  assert.equal(form.get('pageLayout'), '3')
  assert.equal(form.get('updateIndexes'), 'true')
  assert.equal(form.get('exportBookmarks'), 'true')
  assert.equal(form.get('exportFormFields'), 'true')
  assert.equal(form.get('displayPDFDocumentTitle'), 'true')
  const invalidOfficeFields: Record<string, string | boolean>[] = [
    { exportOnlyNotesPages: true },
    { zoom: '125' },
    { firstPageOnLeft: true },
    { initialPage: '1.5' },
    { initialView: '5' },
    { pageLayout: '-1' },
  ]
  for (const fields of invalidOfficeFields) {
    assert.throws(() => validatePayload(request('office-pdf', fields)))
  }
  assert.throws(
    () => validatePayload({ ...request('url-pdf'), advanced: { password: 'wrong-route' } }),
    /not supported/,
  )
  // Source password is still allowed when output PDF is encrypted; these address different documents.
  assert.doesNotThrow(() =>
    validatePayload({
      ...request('office-pdf', { password }),
      postProcess: { ownerPassword: 'output-password' },
    }),
  )
})
