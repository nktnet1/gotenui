import assert from 'node:assert/strict'
import { test } from 'vitest'
import { InputError, validatePayload } from '#/lib/validation'

const parent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
const payload = (overrides: Record<string, unknown>) => ({
  operation: 'url-pdf',
  fields: { url: 'https://example.test' },
  advanced: {},
  ...overrides,
})

test('accepts optional Gotenberg output naming and distinct W3C tracing metadata', () => {
  assert.deepEqual(
    validatePayload(
      payload({
        outputName: 'report october',
        requestTrace: 'report.batch:42',
        traceparent: parent,
        tracestate: 'vendor=abc123,tenant@host=foo/bar',
      }),
    ).payload,
    payload({
      outputName: 'report october',
      requestTrace: 'report.batch:42',
      traceparent: parent,
      tracestate: 'vendor=abc123,tenant@host=foo/bar',
    }),
  )
  assert.equal(validatePayload(payload({})).payload.requestTrace, undefined)
})

test('rejects newline injection, path-like filenames, malformed trace context, and duplicate trace state', () => {
  for (const metadata of [
    { outputName: '../secret' },
    { outputName: 'file.pdf\r\nX-Injected: true' },
    { requestTrace: 'id\r\nAuthorization: bearer-secret' },
    { requestTrace: 'contains spaces' },
    { traceparent: 'ff-0123456789abcdef0123456789abcdef-0123456789abcdef-01' },
    { traceparent: '00-00000000000000000000000000000000-0123456789abcdef-01' },
    { traceparent: '00-0123456789abcdef0123456789abcdef-0000000000000000-01' },
    { traceparent: '00-0123456789abcdef0123456789ABCDEF-0123456789abcdef-01' },
    { tracestate: 'vendor=test' },
    { traceparent: parent, tracestate: 'vendor=a,vendor=b' },
    { traceparent: parent, tracestate: 'Vendor=x' },
    { traceparent: parent, tracestate: 'v=invalid\nheader' },
    { traceparent: parent, tracestate: 'a='.repeat(260) },
    { traceparent: parent, tracestate: Array.from({ length: 33 }, (_, i) => `v${i}=x`).join(',') },
  ]) {
    assert.throws(() => validatePayload(payload(metadata)), InputError, JSON.stringify(metadata))
  }
})
