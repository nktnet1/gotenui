import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  appBasicAuthChallenge,
  parseAppBasicAuth,
  verifyAppBasicAuth,
} from '#/lib/app-basic-auth.server'

const credentials = {
  GOTENUI_BASIC_AUTH_USERNAME: 'test-user',
  GOTENUI_BASIC_AUTH_PASSWORD: 'a:secret with accents é',
}
const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`

describe('optional Gotenui site-wide Basic Auth', () => {
  it('is disabled when both credentials are omitted or intentionally empty', () => {
    assert.equal(parseAppBasicAuth({}), null)
    assert.equal(
      parseAppBasicAuth({ GOTENUI_BASIC_AUTH_USERNAME: '', GOTENUI_BASIC_AUTH_PASSWORD: '' }),
      null,
    )
    assert.equal(appBasicAuthChallenge(null, {}), undefined)
    assert.equal(
      appBasicAuthChallenge(null, {
        GOTENUI_BASIC_AUTH_USERNAME: '',
        GOTENUI_BASIC_AUTH_PASSWORD: '',
      }),
      undefined,
    )
  })

  it('fails closed for missing, blank, or invalid credential pairs', () => {
    for (const env of [
      { GOTENUI_BASIC_AUTH_USERNAME: 'user' },
      { GOTENUI_BASIC_AUTH_USERNAME: '' },
      { GOTENUI_BASIC_AUTH_PASSWORD: '' },
      { GOTENUI_BASIC_AUTH_PASSWORD: 'pass' },
      { GOTENUI_BASIC_AUTH_USERNAME: 'user', GOTENUI_BASIC_AUTH_PASSWORD: '' },
      { GOTENUI_BASIC_AUTH_USERNAME: '', GOTENUI_BASIC_AUTH_PASSWORD: 'pass' },
      { GOTENUI_BASIC_AUTH_USERNAME: '  ', GOTENUI_BASIC_AUTH_PASSWORD: 'pass' },
      { GOTENUI_BASIC_AUTH_USERNAME: 'test:user', GOTENUI_BASIC_AUTH_PASSWORD: 'pass' },
      { GOTENUI_BASIC_AUTH_USERNAME: 'test\ruser', GOTENUI_BASIC_AUTH_PASSWORD: 'pass' },
      { GOTENUI_BASIC_AUTH_USERNAME: 'test', GOTENUI_BASIC_AUTH_PASSWORD: 'pass\nword' },
    ]) {
      assert.throws(() => parseAppBasicAuth(env), /Configure GOTENUI_BASIC_AUTH_/)
    }
  })

  it('returns a standards-compliant challenge without exposing credentials', async () => {
    const challenge = appBasicAuthChallenge(null, credentials)
    assert.equal(challenge?.status, 401)
    assert.equal(
      challenge.headers.get('www-authenticate'),
      'Basic realm="Gotenui", charset="UTF-8"',
    )
    assert.equal(challenge.headers.get('cache-control'), 'no-store')
    assert.equal(await challenge.text(), 'Authentication required.')
    assert.doesNotMatch(JSON.stringify([...challenge.headers]), /test-user|secret/)
  })

  it('accepts valid UTF-8 credentials and rejects malformed and mismatched Authorization', () => {
    const expected = parseAppBasicAuth(credentials)
    assert.ok(expected)
    assert.equal(verifyAppBasicAuth(basic('test-user:a:secret with accents é'), expected), true)
    assert.equal(
      verifyAppBasicAuth(`bAsIc ${basic('test-user:a:secret with accents é').slice(6)}`, expected),
      true,
    )
    assert.equal(
      appBasicAuthChallenge(basic('test-user:a:secret with accents é'), credentials),
      undefined,
    )
    for (const value of [
      null,
      '',
      'Bearer whatever',
      'Basic nonsense$',
      'Basic dGVzdA', // non-canonical missing padding
      basic('test-user:wrong'),
      basic('other:a:secret with accents é'),
      basic('test-user:'),
      `Basic ${'A'.repeat(8193)}`,
    ]) {
      assert.equal(verifyAppBasicAuth(value, expected), false, String(value))
      assert.equal(appBasicAuthChallenge(value, credentials)?.status, 401)
    }
  })
})
