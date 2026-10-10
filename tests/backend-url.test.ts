import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  BACKEND_STORAGE_KEY,
  browserStorage,
  loadBackendUrl,
  normalizeBackendUrl,
  saveBackendUrl,
} from '#/lib/backend-url'

test('normalizes absolute Gotenberg URLs, including path prefixes', () => {
  assert.equal(normalizeBackendUrl(' http://localhost:3000/ '), 'http://localhost:3000')
  assert.equal(
    normalizeBackendUrl('https://docs.example.test/api/'),
    'https://docs.example.test/api',
  )
})

test('rejects credentials, relative paths, opaque schemes, fragments and unsafe addresses', () => {
  for (const value of [
    '',
    '/gotenberg',
    '//evil.test',
    'ftp://example.test',
    'javascript:alert(1)',
    'https://alice:password@example.test',
    'https://example.test/#section',
    'http://example.test/?secret=true',
    'https://example.test\\@evil.test',
    'localhost:3000',
  ]) {
    assert.throws(() => normalizeBackendUrl(value), Error, value)
  }
})

test('stores the selected backend per origin and survives reloads', () => {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
  assert.equal(loadBackendUrl(storage), '')
  assert.equal(saveBackendUrl(storage, ' https://docs.example.test/gotenberg/'), true)
  assert.equal(map.get(BACKEND_STORAGE_KEY), 'https://docs.example.test/gotenberg')
  assert.equal(loadBackendUrl(storage), 'https://docs.example.test/gotenberg')
  map.set(BACKEND_STORAGE_KEY, 'not-a-url')
  assert.equal(loadBackendUrl(storage), '')
  assert.equal(
    saveBackendUrl(
      {
        setItem: () => {
          throw new Error('blocked')
        },
      },
      'https://demo.gotenberg.dev',
    ),
    false,
  )
})

test('does not crash when browser localStorage is unavailable', () => {
  assert.equal(browserStorage(), null)
  assert.equal(loadBackendUrl(null), '')
  assert.equal(saveBackendUrl(null, 'https://demo.gotenberg.dev'), false)
})
