import assert from 'node:assert/strict'
import { test } from 'vitest'
import { LatestProbe } from '#/lib/latest-probe'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function receiver<T>() {
  const values: T[] = []
  const errors: unknown[] = []
  let settled = 0
  return {
    values,
    errors,
    get settled() {
      return settled
    },
    callbacks: {
      success: (value: T) => values.push(value),
      error: (error: unknown) => errors.push(error),
      settled: () => {
        settled++
      },
    },
  }
}

test('an obsolete connection test cannot publish a late successful result', async () => {
  const probe = new LatestProbe()
  const result = deferred<string>()
  const received = receiver<string>()
  let signal: AbortSignal | undefined
  const pending = probe.run((passedSignal) => {
    signal = passedSignal
    return result.promise
  }, received.callbacks)
  probe.cancel()
  assert.equal(signal?.aborted, true)
  result.resolve('old version')
  await pending
  assert.deepEqual(received.values, [])
  assert.deepEqual(received.errors, [])
  assert.equal(received.settled, 0)
})

test('only the newest connection test can settle the dialog', async () => {
  const probe = new LatestProbe()
  const earlier = deferred<string>()
  const later = deferred<string>()
  const received = receiver<string>()
  const first = probe.run(() => earlier.promise, received.callbacks)
  const second = probe.run(() => later.promise, received.callbacks)
  later.resolve('9.0.0')
  await second
  earlier.reject(new Error('stale HTTP 401'))
  await first
  assert.deepEqual(received.values, ['9.0.0'])
  assert.deepEqual(received.errors, [])
  assert.equal(received.settled, 1)
})

test('a current connection test reports errors and allows another test', async () => {
  const probe = new LatestProbe()
  const received = receiver<string>()
  await probe.run(() => Promise.reject(new Error('HTTP 401')), received.callbacks)
  await probe.run(() => Promise.resolve('8.40.0'), received.callbacks)
  assert.deepEqual(received.values, ['8.40.0'])
  assert.equal((received.errors[0] as Error)?.message, 'HTTP 401')
  assert.equal(received.settled, 2)
})
