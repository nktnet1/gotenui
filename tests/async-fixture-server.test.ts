import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'vitest'
import { asyncFixtureHandler } from './integration/async-fixture-server'

test('disposable receiver enforces download header and records retries/events without secrets', async () => {
  const handle = asyncFixtureHandler()
  const server = createServer((request, response) => {
    if (!handle(request, response)) response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP port')
    const base = `http://127.0.0.1:${address.port}`
    const forbidden = await fetch(`${base}/gotenui-remote/document.txt`)
    assert.equal(forbidden.status, 403)
    const remote = await fetch(`${base}/gotenui-remote/document.txt`, {
      headers: { 'X-Gotenui-Remote-Token': 'fixture-remote-key' },
    })
    assert.equal(remote.status, 200)
    assert.match(remote.headers.get('content-disposition') ?? '', /filename="remote-input.txt"/)
    assert.match(await remote.text(), /Gotenberg downloadFrom/)
    const token = randomUUID()
    const url = `${base}/gotenui-callbacks/${token}/retry`
    const body = '%PDF-1.7 test document'
    const first = await fetch(url, {
      method: 'POST',
      headers: {
        'Gotenberg-Trace': 'fixture-trace',
        'X-Gotenui-Callback-Token': 'fixture-callback-key',
      },
      body,
    })
    assert.equal(first.status, 503)
    const second = await fetch(url, { method: 'POST', body })
    assert.equal(second.status, 200)
    const event = await fetch(`${base}/gotenui-callbacks/${token}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'webhook.success', correlationId: 'fixture-trace' }),
    })
    assert.equal(event.status, 200)
    const recorded = await fetch(`${base}/_gotenui_callbacks/${token}`)
    const receipts: Record<string, unknown>[] = await recorded.json()
    assert.equal(receipts.length, 3)
    assert.deepEqual(
      receipts.map((item) => item.kind),
      ['retry', 'retry', 'events'],
    )
    assert.equal(receipts[0]?.testHeaderPresent, true)
    assert.equal(receipts[0]?.trace, 'fixture-trace')
    assert.equal(receipts[0]?.beginsPdf, true)
    assert.equal(receipts[2]?.event, 'webhook.success')
    assert.equal(receipts[2]?.correlationId, 'fixture-trace')
    assert.equal(JSON.stringify(receipts).includes('fixture-callback-key'), false)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
