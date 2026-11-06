import assert from 'node:assert/strict'
import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { test, vi } from 'vitest'
import { pullImage } from './integration/docker.setup'

function fakeDocker() {
  const child = new EventEmitter()
  const start = vi.fn(() => child) as unknown as typeof spawn
  return { child, start }
}

test('Docker image pull streams progress to the terminal instead of buffering it', async () => {
  const { child, start } = fakeDocker()
  const pulling = pullImage('gotenberg/gotenberg:9.0.0', start)
  assert.deepEqual(vi.mocked(start).mock.calls[0], [
    'docker',
    ['pull', 'gotenberg/gotenberg:9.0.0'],
    { stdio: ['ignore', 'inherit', 'inherit'], timeout: 600_000 },
  ])
  child.emit('close', 0, null)
  await pulling
})

test('Docker pull reports an error rather than starting tests with a missing image', async () => {
  const { child, start } = fakeDocker()
  const pulling = pullImage('gotenberg/gotenberg:8.40.0', start)
  child.emit('close', 1, null)
  await assert.rejects(pulling, /Docker pull failed.*8\.40\.0/)
})

test('Docker pull reports an executable launch failure', async () => {
  const { child, start } = fakeDocker()
  const pulling = pullImage('gotenberg/gotenberg:9.0.0', start)
  child.emit('error', new Error('Docker command unavailable'))
  await assert.rejects(pulling, /Docker command unavailable/)
})
