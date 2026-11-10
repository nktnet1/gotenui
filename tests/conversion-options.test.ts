import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  type ChromiumCookie,
  type ChromiumResourceHeader,
  chromiumNetworkFields,
} from '#/lib/chromium-network'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { adaptConversionForm } from '#/lib/gotenberg-conversion-adapter'
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

test('window.status wait is available across Chromium PDF and screenshot editors', () => {
  for (const id of [
    'url-pdf',
    'html-pdf',
    'markdown-pdf',
    'url-shot',
    'html-shot',
    'markdown-shot',
  ]) {
    const operation = OPERATION_BY_ID.get(id)
    assert.ok(operation)
    assert.ok(
      operation.fields.some(({ name }) => name === 'waitWindowStatus'),
      id,
    )
    const validated = validatePayload(request(id, { waitWindowStatus: 'ready' }))
    const form = createGotenbergForm(validated.operation, validated.payload, [], [])
    assert.equal(form.get('waitWindowStatus'), 'ready', id)
  }
  assert.throws(
    () => validatePayload(request('url-pdf', { waitWindowStatus: 'invalid\nstatus' })),
    /Invalid Chromium waitWindowStatus/,
  )
  assert.throws(
    () => validatePayload(request('office-pdf', { waitWindowStatus: 'ready' })),
    /Unsupported field/,
  )
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

test('unscoped public headers do not emit an invalid empty Gotenberg scope', () => {
  const settings = chromiumNetworkFields(
    [],
    [
      { name: 'X-Request-Id', value: 'trace-42', scope: '   ' },
      { name: 'X-Feature-Flag', value: 'enabled', scope: '^https://example\\.test/' },
    ],
  )
  assert.deepEqual(JSON.parse(settings.extraHttpHeaders), {
    'X-Request-Id': 'trace-42',
    'X-Feature-Flag': 'enabled;scope=^https://example\\.test/',
  })
  for (const operationId of ['url-pdf', 'html-shot'] as const) {
    const { operation, payload } = validatePayload(request(operationId, settings))
    const v8Form = createGotenbergForm(operation, payload, [], [])
    assert.equal(v8Form.get('extraHttpHeaders'), settings.extraHttpHeaders)
    const v9Form = adaptConversionForm(operation, payload, v8Form, 9)
    assert.equal(v9Form.get('extraHttpHeaders'), settings.extraHttpHeaders)
  }
})

test('rejects malformed scope tokens from direct requests and preserves safe editor headers', () => {
  for (const headerValue of ['visible;scope', 'scope', 'visible;SCOPE   ']) {
    assert.throws(
      () =>
        validatePayload(
          request('url-pdf', { extraHttpHeaders: JSON.stringify({ 'X-Public': headerValue }) }),
        ),
      /scope/i,
    )
  }
  assert.doesNotThrow(() =>
    validatePayload(
      request('url-pdf', { extraHttpHeaders: JSON.stringify({ 'X-Public': 'visible;scoped' }) }),
    ),
  )
  for (const value of ['token;SCOPE=^https://example.test/', 'scope', 'token; Scope']) {
    assert.throws(() => chromiumNetworkFields([], [{ ...header, value }]), /URL scope/)
  }
  assert.throws(
    () => chromiumNetworkFields([], [{ ...header, scope: '   ' }]),
    /Authentication headers require an explicit URL scope/,
  )
})

test('rejects URL scopes that Gotenberg would silently truncate or rewrite', () => {
  // Gotenberg splits the value on semicolons and strips whitespace from
  // the scope token. The former broadens this credential regex to /private.
  for (const scope of [
    '^https://portal\\.example\\.test/private;admin',
    '^https://portal\\.example\\.test/private admin',
    '^https://portal\\.example\\.test/[ a-z]+',
  ]) {
    assert.throws(
      () => chromiumNetworkFields([], [{ ...header, scope }]),
      /scope.*semicolons or whitespace/i,
    )
  }

  for (const value of [
    'Bearer secret;scope=^https://portal\\.example\\.test/private;admin',
    'Bearer secret;scope=^https://portal\\.example\\.test/private;more=value',
  ]) {
    assert.throws(
      () =>
        validatePayload(
          request('url-pdf', { extraHttpHeaders: JSON.stringify({ Authorization: value }) }),
        ),
      /scope last/i,
    )
  }
  assert.throws(
    () =>
      validatePayload(
        request('html-shot', {
          extraHttpHeaders: JSON.stringify({
            Authorization: 'Bearer secret;scope=^https://portal\\.example\\.test/a b',
          }),
        }),
      ),
    /scope.*semicolons or whitespace/i,
  )

  // Backslash regex escapes retain their meaning and need no rewriting.
  const escaped = '^https://portal\\.example\\.test/private\\x3Badmin'
  const fromEditor = chromiumNetworkFields([], [{ ...header, scope: escaped }])
  assert.doesNotThrow(() => validatePayload(request('url-pdf', fromEditor)))
  // Normal non-sensitive headers may still contain semicolon-delimited values.
  assert.doesNotThrow(() =>
    validatePayload(
      request('url-pdf', {
        extraHttpHeaders: JSON.stringify({ 'X-Feature': 'one;scope=^https://example\\.test/;two' }),
      }),
    ),
  )
})

test('session, CSRF and signature credentials cannot be sent to unscoped Chromium assets', () => {
  const protectedHeaders = ['X-Session-ID', 'X-CSRF', 'X-XSRF', 'X-Signature']
  for (const name of protectedHeaders) {
    assert.throws(
      () => chromiumNetworkFields([], [{ name, value: 'private', scope: '' }]),
      /Authentication headers require an explicit URL scope/,
      name,
    )
    for (const operationId of ['url-pdf', 'html-shot']) {
      assert.throws(
        () =>
          validatePayload(
            request(operationId, { extraHttpHeaders: JSON.stringify({ [name]: 'private' }) }),
          ),
        /Authentication headers require an explicit URL scope/,
        `${operationId}: ${name}`,
      )
    }

    const fields = chromiumNetworkFields(
      [],
      [{ name, value: 'private', scope: '^https://portal\\.example\\.test/' }],
    )
    const { operation, payload } = validatePayload(request('url-pdf', fields))
    const v8 = createGotenbergForm(operation, payload, [], [])
    assert.equal(v8.get('extraHttpHeaders'), fields.extraHttpHeaders)
    assert.equal(
      adaptConversionForm(operation, payload, v8, 9).get('extraHttpHeaders'),
      fields.extraHttpHeaders,
    )
    assert.throws(
      () =>
        validatePayload(
          request('url-pdf', {
            extraHttpHeaders: JSON.stringify({
              [name]: 'private;scope=^https://portal\\.example\\.test/;leaked',
            }),
          }),
        ),
      /scope last/i,
    )
  }
  assert.doesNotThrow(() =>
    validatePayload(
      request(
        'url-pdf',
        chromiumNetworkFields([], [{ name: 'X-Request-ID', value: 'public', scope: '' }]),
      ),
    ),
  )
})

test('Chromium header editor rejects names and values that the proxy would reject', () => {
  for (const name of ['Cookie', 'Host', 'Proxy-Authorization', 'Bad Name', '']) {
    assert.throws(
      () =>
        chromiumNetworkFields([], [{ name, value: 'private', scope: '^https://example.test/' }]),
      /Invalid or unsafe Chromium resource header name/,
      name,
    )
  }
  assert.throws(
    () => chromiumNetworkFields([], [{ name: 'X-Request-ID', value: 'a\r\nb', scope: '' }]),
    /Invalid Chromium resource header value/,
  )
  assert.throws(
    () =>
      chromiumNetworkFields(
        [],
        Array.from({ length: 65 }, (_, id) => ({
          name: `X-Request-${id}`,
          value: 'ok',
          scope: '',
        })),
      ),
    /at most 64 entries/,
  )
})

test('editor retains special HTTP token names without modifying the object prototype', () => {
  const settings = chromiumNetworkFields(
    [],
    [
      { name: '__proto__', value: 'public-value', scope: '' },
      { name: 'constructor', value: 'other-value', scope: '' },
    ],
  )
  assert.deepEqual(Object.entries(JSON.parse(settings.extraHttpHeaders)), [
    ['__proto__', 'public-value'],
    ['constructor', 'other-value'],
  ])
  assert.doesNotThrow(() => validatePayload(request('html-shot', settings)))
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
  for (const bad of ['{}', '{']) {
    assert.throws(() => validatePayload(request('url-pdf', { cookies: bad })), /cookie/i)
  }
})

test('accepts long Chromium cookie values and case-insensitive SameSite settings', () => {
  // Gotenberg 9 explicitly normalises SameSite before decoding the cookies.
  const longValue = `jwt-${'x'.repeat(4_096)}`
  const cookies = [
    {
      ...cookie,
      name: `session_${'y'.repeat(150)}`,
      value: longValue,
      path: `/${'p'.repeat(600)}`,
      sameSite: 'lAx',
    },
    { ...cookie, sameSite: 'nOnE' },
  ]
  const fields = request('url-pdf', { cookies: JSON.stringify(cookies) })
  const { payload, operation } = validatePayload(fields)
  assert.deepEqual(
    JSON.parse(String(createGotenbergForm(operation, payload, [], []).get('cookies'))),
    cookies,
  )
  assert.throws(
    () =>
      validatePayload(request('url-pdf', { cookies: JSON.stringify([{ ...cookie, value: ' ' }]) })),
    /cookie/i,
  )
  assert.throws(
    () =>
      validatePayload(
        request('url-pdf', {
          cookies: JSON.stringify([{ ...cookie, sameSite: 'nOnE', secure: false }]),
        }),
      ),
    /SameSite=None/,
  )
})

test('forwards large scoped Chromium header values without an artificial length cap', () => {
  const value = `Bearer ${'x'.repeat(8_192)};scope=^https://internal\\.example\\.test/`
  const fields = request('url-pdf', { extraHttpHeaders: JSON.stringify({ Authorization: value }) })
  const { operation, payload } = validatePayload(fields)
  assert.deepEqual(
    JSON.parse(String(createGotenbergForm(operation, payload, [], []).get('extraHttpHeaders'))),
    { Authorization: value },
  )
})

test('rejects secret browser headers without a scope, unsafe header names and malformed scoped headers', () => {
  for (const fields of [
    { Authorization: 'Bearer secret' },
    { 'X-Api-Key': 'secret' },
    { Host: 'private.example.test' },
    { 'Set-Cookie': 'a=b' },
    { 'X-Safe': 'secret\r\nCookie: a=b' },
    { Authorization: 'Bearer secret;scope=' },
    { Authorization: 'Bearer secret;scope=^https://a\\.test/;scope=^https://b\\.test/' },
    { Authorization: `Bearer secret;scope=${'a'.repeat(1025)}` },
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

test('accepts Chromium resource headers to Gotenberg 9 limits and delegates regexp2 syntax', () => {
  const manyHeaders = Object.fromEntries(
    Array.from({ length: 64 }, (_, i) => [
      `X-Header-${i}`,
      `value-${i};scope=^https://example\\.test/`,
    ]),
  )
  const encoded = JSON.stringify(manyHeaders)
  const parsed = validatePayload(request('url-pdf', { extraHttpHeaders: encoded }))
  assert.equal(parsed.payload.fields.extraHttpHeaders, encoded)
  assert.throws(
    () =>
      validatePayload(
        request('url-pdf', {
          extraHttpHeaders: JSON.stringify({
            ...manyHeaders,
            'X-Extra': 'additional;scope=^https://',
          }),
        }),
      ),
    /64 entries/,
  )

  // Gotenberg 9 uses .NET regexp2, not JavaScript RegExp: (?i) is valid upstream.
  const dotNetPattern = '(?i)^https://portal\\.example\\.test/'
  for (const scope of [dotNetPattern, 'a'.repeat(1024)]) {
    assert.doesNotThrow(() =>
      validatePayload(
        request('url-pdf', {
          extraHttpHeaders: JSON.stringify({ Authorization: `Bearer token;SCOPE=${scope}` }),
        }),
      ),
    )
  }
  for (const scope of ['a'.repeat(1025), 'é'.repeat(513)]) {
    assert.throws(
      () =>
        validatePayload(
          request('url-pdf', {
            extraHttpHeaders: JSON.stringify({ Authorization: `Bearer token;scope=${scope}` }),
          }),
        ),
      /1,024 UTF-8 bytes/,
    )
  }
  // Invalid syntax is diagnosed by the backend's regexp2 compiler.
  assert.doesNotThrow(() =>
    validatePayload(
      request('url-pdf', {
        extraHttpHeaders: JSON.stringify({ Authorization: 'Bearer secret;scope=^https://[broken' }),
      }),
    ),
  )
  assert.doesNotThrow(() => validatePayload(request('url-pdf', { extraHttpHeaders: '{}' })))
})

test('preserves valid HTTP token header names and empty Chromium resource header values', () => {
  const headers = {
    X_Trace_ID: 'trace-123',
    'X-Empty': '',
    Authorization: 'scope=^https://portal\\.example\\.test/',
  }
  const raw = JSON.stringify(headers)
  for (const operationId of ['url-pdf', 'html-shot']) {
    const { operation, payload } = validatePayload(request(operationId, { extraHttpHeaders: raw }))
    assert.equal(createGotenbergForm(operation, payload, [], []).get('extraHttpHeaders'), raw)
  }
  assert.doesNotThrow(() =>
    validatePayload(
      request('url-pdf', {
        extraHttpHeaders: JSON.stringify({ [`X-${'a'.repeat(120)}`]: 'value' }),
      }),
    ),
  )
})

test('supports large Chromium cookie lists without an unrelated 20-cookie cap', () => {
  const cookies = Array.from({ length: 64 }, (_, index) => ({
    ...cookie,
    name: `session_${index}`,
  }))
  const settings = chromiumNetworkFields(cookies, [])
  const parsed = validatePayload(request('html-shot', settings))
  const spec = OPERATION_BY_ID.get('html-shot')
  assert.ok(spec)
  assert.equal(createGotenbergForm(spec, parsed.payload, [], []).get('cookies'), settings.cookies)
  assert.doesNotThrow(() => validatePayload(request('url-pdf', { cookies: '[]' })))
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
