import assert from 'node:assert/strict'
import { test } from 'vitest'
import { type ObservedConnectionStatus, statusForConnection } from '#/lib/connection-status'

const status = { online: true, version: '8.40.0', modules: [] }

test('status from a previous connection or credential epoch is never reused', () => {
  const observed: ObservedConnectionStatus = { key: 'server:primary:1', value: status }
  assert.equal(statusForConnection(observed, 'server:primary:1'), status)
  assert.equal(statusForConnection(observed, 'server:primary:2'), null)
  assert.equal(statusForConnection(observed, 'server:backup:1'), null)
  assert.equal(statusForConnection(null, 'server:primary:1'), null)
})

test('a refreshed v9 status only enables v9 tools for the active identity', () => {
  const current = { key: 'browser-prod:3', value: { online: true, version: '9.0.0', modules: [] } }
  assert.equal(statusForConnection(current, 'browser-prod:3')?.version, '9.0.0')
  assert.equal(statusForConnection(current, 'browser-prod:4'), null)
})
