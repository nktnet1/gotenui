import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  chromeSmokeArguments,
  chromeSmokeEnvironment,
  chromeSmokeTransports,
} from '#scripts/chrome-launch'
import { parseChromeActivePort } from '#scripts/chrome-socket'

test('Chrome smoke strips inherited D-Bus addresses and retains unrelated environment', () => {
  const env = chromeSmokeEnvironment({
    DBUS_SESSION_BUS_ADDRESS: 'bad',
    DBUS_SYSTEM_BUS_ADDRESS: 'bad',
    PATH: '/bin',
  })
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, undefined)
  assert.equal(env.DBUS_SYSTEM_BUS_ADDRESS, undefined)
  assert.equal(env.PATH, '/bin')
})

test('Chrome fallback binds debugging on loopback with a unique profile instead of pipe descriptors', () => {
  const pipe = chromeSmokeArguments('/tmp/first', 'pipe')
  const socket = chromeSmokeArguments('/tmp/second', 'socket')
  assert.ok(pipe.includes('--remote-debugging-pipe'))
  assert.ok(!pipe.some((value) => value.startsWith('--remote-debugging-port=')))
  assert.ok(socket.includes('--remote-debugging-port=0'))
  assert.ok(socket.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(socket.includes('--user-data-dir=/tmp/second'))
  assert.ok(!socket.includes('--remote-debugging-pipe'))
})

test('Chrome fallback accepts only DevToolsActivePort loopback endpoints', () => {
  assert.equal(
    parseChromeActivePort('39125\n/devtools/browser/ab10-34ef\n'),
    'ws://127.0.0.1:39125/devtools/browser/ab10-34ef',
  )
  for (const invalid of [
    '0\n/devtools/browser/id',
    '65536\n/devtools/browser/id',
    '5000\nhttp://evil.example',
    '5000\n/devtools/page/id',
    '5000\n/devtools/browser/id\nextra',
    'not-a-port\n/devtools/browser/id',
  ]) {
    assert.throws(() => parseChromeActivePort(invalid), /invalid DevToolsActivePort/)
  }
})

test('CI browser smoke uses WebSocket first and retries across transports', () => {
  assert.deepEqual(chromeSmokeTransports, ['socket', 'pipe', 'socket'])
})
