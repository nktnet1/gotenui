import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BACKEND_STORAGE_KEY,
  browserStorage,
  loadBackendUrl,
  normalizeBackendUrl,
  saveBackendUrl,
} from '../src/lib/backend-url.ts'

test('normalizes browser-reachable Gotenberg addresses and reverse-proxy paths', () => {
  assert.equal(normalizeBackendUrl(' http://localhost:3000/ '), 'http://localhost:3000')
  assert.equal(
    normalizeBackendUrl('https://docs.example.test/api/'),
    'https://docs.example.test/api',
  )
  assert.equal(normalizeBackendUrl('/gotenberg/'), '/gotenberg')
  assert.equal(normalizeBackendUrl('/'), '/')
})

test('rejects credentials, opaque schemes, fragments, protocol-relative and unsafe paths', () => {
  for (const value of [
    '',
    '//evil.test',
    'ftp://example.test',
    'javascript:alert(1)',
    'https://alice:password@example.test',
    'https://example.test/#section',
    'http://example.test/?secret=true',
    '/gotenberg/../admin',
    '/gotenberg?token=secret',
    '/gotenberg\\foo',
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
      '/gotenberg',
    ),
    false,
  )
})

test('does not crash when browser localStorage is unavailable', () => {
  assert.equal(browserStorage(), null)
  assert.equal(loadBackendUrl(null), '')
  assert.equal(saveBackendUrl(null, '/gotenberg'), false)
})
