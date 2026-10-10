import assert from 'node:assert/strict'
import { test } from 'vitest'
import { BACKEND_STORAGE_KEY } from '#/lib/backend-url'
import {
  CONNECTIONS_STORAGE_KEY,
  DEFAULT_CONNECTION_ID,
  defaultBrowserConnections,
  loadConnections,
  makeBrowserAuthorization,
  newBrowserConnection,
  saveConnections,
} from '#/lib/connection-profiles'

const demo = 'https://demo.gotenberg.dev'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

test('defaults to public demo and migrates a v1.0.9 URL', () => {
  assert.deepEqual(loadConnections(null, demo), defaultBrowserConnections(demo))
  const storage = memoryStorage()
  storage.setItem(BACKEND_STORAGE_KEY, 'https://pdf.example.test/path/')
  const migrated = loadConnections(storage, demo)
  assert.equal(migrated.selected, 'browser-legacy')
  assert.equal(migrated.browsers[0]?.id, DEFAULT_CONNECTION_ID)
  assert.equal(migrated.browsers[1]?.url, 'https://pdf.example.test/path')
})

test('multiple browser connections and selection persist without credentials', () => {
  const storage = memoryStorage()
  const saved = defaultBrowserConnections(demo)
  saved.browsers.push(
    newBrowserConnection('Private PDF', 'https://pdf.example.test', 'basic', 'browser-private'),
  )
  saved.selected = 'browser-private'
  assert.equal(saveConnections(storage, saved), true)
  const value = storage.values.get(CONNECTIONS_STORAGE_KEY) ?? ''
  assert.doesNotMatch(value, /password|token|secret|authorization/i)
  assert.deepEqual(loadConnections(storage, demo), saved)
})

test('storage parsing strips extra secret fields and fails safely on invalid data', () => {
  const storage = memoryStorage()
  storage.setItem(
    CONNECTIONS_STORAGE_KEY,
    JSON.stringify({
      selected: 'browser-foo',
      browsers: [
        {
          id: 'browser-foo',
          name: 'Foo',
          url: 'https://pdf.example.test',
          auth: 'none',
          password: 'do-not-store',
        },
      ],
    }),
  )
  const loaded = loadConnections(storage, demo)
  assert.equal('password' in loaded.browsers[0], false)
  assert.equal(saveConnections(storage, loaded), true)
  assert.doesNotMatch(storage.values.get(CONNECTIONS_STORAGE_KEY) ?? '', /do-not-store/)
  storage.setItem(CONNECTIONS_STORAGE_KEY, '{not json')
  assert.deepEqual(loadConnections(storage, demo), defaultBrowserConnections(demo))
})

test('browser Basic and bearer credentials are constructed only in memory', () => {
  const basic = makeBrowserAuthorization('basic', 'üser', 'pässword')
  assert.equal(basic, `Basic ${Buffer.from('üser:pässword').toString('base64')}`)
  assert.equal(makeBrowserAuthorization('bearer', '', 'a.valid-token_1'), 'Bearer a.valid-token_1')
  assert.equal(makeBrowserAuthorization('none', '', ''), undefined)
  assert.throws(() => makeBrowserAuthorization('basic', 'bad:name', 'password'))
  assert.throws(() => makeBrowserAuthorization('bearer', '', 'token with spaces'))
})
