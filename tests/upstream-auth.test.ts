import assert from 'node:assert/strict'
import { test } from 'vitest'
import { parseAllowedBackends } from '#/lib/proxy-policy'
import { basicAuthHeadersForBackend, parseUpstreamBasicAuth } from '#/lib/upstream-auth.server'

const publicUrl = 'https://demo.gotenberg.dev'
const privateUrl = 'https://pdf.example.test/gotenberg'
const allowed = parseAllowedBackends(`${publicUrl},${privateUrl}`)
const credentials = {
  GOTENBERG_BASIC_AUTH_URL: `${privateUrl}/`,
  GOTENBERG_BASIC_AUTH_USERNAME: 'document-user',
  GOTENBERG_BASIC_AUTH_PASSWORD: 'a:password with spaces',
}

test('basic auth is opt-in and does not change anonymous demo requests', () => {
  assert.equal(parseUpstreamBasicAuth({}, allowed), undefined)
  assert.equal(basicAuthHeadersForBackend(publicUrl, undefined), undefined)
})

test('basic auth headers are UTF-8 encoded and bound to the exact approved URL', () => {
  const auth = parseUpstreamBasicAuth(credentials, allowed)
  assert.ok(auth)
  assert.equal(auth.target, privateUrl)
  const headers = new Headers(basicAuthHeadersForBackend(privateUrl, auth))
  assert.equal(
    headers.get('authorization'),
    `Basic ${Buffer.from('document-user:a:password with spaces').toString('base64')}`,
  )
  for (const url of [publicUrl, 'https://pdf.example.test', `${privateUrl}/other`]) {
    assert.equal(basicAuthHeadersForBackend(url, auth), undefined)
  }
})

test('incomplete, invalid, or unapproved basic auth configurations fail closed', () => {
  for (const env of [
    { GOTENBERG_BASIC_AUTH_USERNAME: 'user' },
    { ...credentials, GOTENBERG_BASIC_AUTH_PASSWORD: '' },
    { ...credentials, GOTENBERG_BASIC_AUTH_USERNAME: 'name:with-colon' },
    { ...credentials, GOTENBERG_BASIC_AUTH_URL: 'https://pdf.example.test' },
    { ...credentials, GOTENBERG_BASIC_AUTH_URL: 'https://pdf.example.test.evil.test/gotenberg' },
    { ...credentials, GOTENBERG_BASIC_AUTH_URL: 'https://user:pass@pdf.example.test/gotenberg' },
  ]) {
    assert.throws(() => parseUpstreamBasicAuth(env, allowed))
  }
})
