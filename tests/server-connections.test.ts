import assert from 'node:assert/strict'
import { test } from 'vitest'
import { parseBrowserAuthorization, resolveConnectionTarget } from '#/lib/connection-target.server'
import { parseAllowedBackends } from '#/lib/proxy-policy'
import {
  parseServerConnections,
  publicServerConnections,
  requireServerConnection,
} from '#/lib/server-connections.server'

const demo = 'https://demo.gotenberg.dev'
const privateA = 'https://a.example.test/gotenberg'
const privateB = 'https://b.example.test'
const allowed = parseAllowedBackends(`${demo},${privateA},${privateB}`)
const accessKey = 'sample-connection-access-key-123'
const config: NodeJS.ProcessEnv = {
  GOTENUI_PROFILE_ACCESS_KEY: accessKey,
  GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
    {
      id: 'accounting',
      name: 'Accounting',
      url: `${privateA}/`,
      auth: { type: 'basic', username: 'alice', password: 'secret-one' },
    },
    {
      id: 'records',
      name: 'Records',
      url: privateB,
      auth: { type: 'bearer', token: 'eyJ.valid.token' },
    },
  ]),
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://gotenui.example.test/api/gotenberg/convert', { headers })
}

test('server registry contains multiple independent authentication methods', () => {
  const { connections, accessKey: key } = parseServerConnections(config, allowed)
  assert.equal(key, accessKey)
  assert.equal(connections[0]?.url, privateA)
  assert.equal(
    connections[0]?.authorization,
    `Basic ${Buffer.from('alice:secret-one').toString('base64')}`,
  )
  assert.equal(connections[1]?.authorization, 'Bearer eyJ.valid.token')
  assert.deepEqual(publicServerConnections(connections), [
    { id: 'accounting', name: 'Accounting', requiresKey: true },
    { id: 'records', name: 'Records', requiresKey: true },
  ])
  assert.doesNotMatch(
    JSON.stringify(publicServerConnections(connections)),
    /secret-one|eyJ\.valid|\.test/,
  )
})

test('server target is resolved exclusively from a protected connection ID', () => {
  const settings = { allowed, ...parseServerConnections(config, allowed) }
  const result = resolveConnectionTarget(
    request({ 'X-Gotenui-Profile-Access-Key': accessKey }),
    settings,
    null,
    'accounting',
  )
  assert.equal(result.url, privateA)
  assert.equal(
    new Headers(result.headers).get('authorization'),
    settings.connections[0]?.authorization,
  )
  assert.throws(
    () => requireServerConnection('records', 'wrong', settings.connections, settings.accessKey),
    (error: { status?: number }) => error.status === 403,
  )
  assert.throws(
    () => resolveConnectionTarget(request(), settings, null, 'accounting'),
    (error: { status?: number }) => error.status === 403,
  )
  assert.throws(
    () =>
      resolveConnectionTarget(
        request({ 'X-Gotenui-Upstream-Authorization': 'Bearer forged' }),
        settings,
        null,
        'records',
      ),
    /cannot override/,
  )
  assert.throws(
    () => resolveConnectionTarget(request(), settings, privateA, 'accounting'),
    /cannot override/,
  )
})

test('browser URL selection never inherits server-managed credentials', () => {
  const settings = { allowed, ...parseServerConnections(config, allowed) }
  const anonymous = resolveConnectionTarget(request(), settings, privateA, null)
  assert.equal(anonymous.url, privateA)
  assert.equal(anonymous.headers, undefined)
  const token = resolveConnectionTarget(
    request({ 'X-Gotenui-Upstream-Authorization': 'Bearer browser-token' }),
    settings,
    privateA,
    null,
  )
  assert.equal(new Headers(token.headers).get('authorization'), 'Bearer browser-token')
  assert.throws(
    () =>
      resolveConnectionTarget(
        request({ 'X-Gotenui-Upstream-Authorization': 'Bearer oops' }),
        settings,
        demo,
        null,
      ),
    /public Gotenberg demo/,
  )
  assert.throws(
    () => resolveConnectionTarget(request(), settings, 'https://metadata.google.internal', null),
    (error: { status?: number }) => error.status === 403,
  )
  assert.throws(
    () =>
      resolveConnectionTarget(
        request({ 'X-Gotenui-Profile-Access-Key': accessKey }),
        settings,
        privateA,
        null,
      ),
    /Access keys cannot/,
  )
})

test('auth values must be valid Basic/Bearer strings', () => {
  assert.equal(parseBrowserAuthorization(null), undefined)
  assert.equal(parseBrowserAuthorization('Bearer a.b_c-123'), 'Bearer a.b_c-123')
  const basic = `Basic ${Buffer.from('alice:password').toString('base64')}`
  assert.equal(parseBrowserAuthorization(basic), basic)
  for (const value of [
    'Basic !invalid!',
    'Basic dGVzdA==',
    'Bearer invalid value',
    'Bearer a\nb',
    'Digest foo',
  ]) {
    assert.throws(() => parseBrowserAuthorization(value), Error)
  }
})

test('invalid registry configurations fail closed', () => {
  for (const env of [
    { GOTENUI_SERVER_CONNECTIONS: config.GOTENUI_SERVER_CONNECTIONS },
    { ...config, GOTENUI_PROFILE_ACCESS_KEY: 'short' },
    { ...config, GOTENUI_SERVER_CONNECTIONS: '{oops' },
    {
      ...config,
      GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
        {
          id: 'hidden',
          name: 'Hidden',
          url: 'http://169.254.169.254/latest',
          auth: { type: 'basic', username: 'a', password: 'b' },
        },
      ]),
    },
    {
      ...config,
      GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
        { id: 'demo', name: 'Demo', url: demo, auth: { type: 'bearer', token: 'secret' } },
      ]),
    },
    {
      ...config,
      GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
        { id: 'duplicate', name: 'A', url: privateA },
        { id: 'duplicate', name: 'B', url: privateB },
      ]),
    },
  ])
    assert.throws(() => parseServerConnections(env, allowed))
})
