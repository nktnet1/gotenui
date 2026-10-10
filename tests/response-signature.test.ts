import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { proxyConversionRequest, proxyErrorResponse } from '#/lib/gotenberg-proxy.server'
import { verifyConversionSignature } from '#/lib/response-signature'

const origin = 'https://app.example.test'
const upstreamUrl = 'http://127.0.0.1:3000'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', upstreamUrl))
afterEach(() => vi.unstubAllEnvs())

function requestFor(operation = 'url-pdf', fields = { url: 'https://example.test' }): Request {
  const body = new FormData()
  body.set('payload', JSON.stringify({ operation, fields, advanced: {} }))
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { origin, 'X-Gotenberg-Url': upstreamUrl },
    body,
  })
}

const binaryCases: { type: string; content: Uint8Array }[] = [
  { type: 'application/pdf', content: new TextEncoder().encode('%PDF-1.7\n') },
  { type: 'application/zip', content: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]) },
  { type: 'application/zip', content: new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0]) },
  { type: 'application/zip', content: new Uint8Array([0x50, 0x4b, 0x07, 0x08, 0, 0]) },
  { type: 'image/png', content: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]) },
  { type: 'image/jpeg', content: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1]) },
  { type: 'image/webp', content: new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ') },
]

for (const { type, content } of binaryCases) {
  test(`accepts and forwards ${type} without changing bytes`, async () => {
    const verified = await verifyConversionSignature(
      new Blob([new Uint8Array(content)]).stream(),
      type,
    )
    const bytes = await new Response(verified).arrayBuffer()
    assert.deepEqual(new Uint8Array(bytes), content)
  })
}

test('validates fragmented prefixes without waiting for the rest of the document', async () => {
  const input = new TextEncoder().encode('%PDF-1.7\nrest')
  let sendTail: (() => void) | undefined
  let deliveredTail = false
  const ready = new Promise<void>((resolve) => {
    sendTail = resolve
  })
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input.slice(0, 2))
      controller.enqueue(input.slice(2, 4))
      controller.enqueue(input.slice(4, 7))
    },
    async pull(controller) {
      await ready
      if (!deliveredTail) {
        deliveredTail = true
        controller.enqueue(input.slice(7))
        controller.close()
      }
    },
  })
  const verified = await verifyConversionSignature(source, 'application/pdf')
  assert.equal(deliveredTail, false, 'Verification must not await the entire PDF')
  sendTail?.()
  assert.deepEqual(new Uint8Array(await new Response(verified).arrayBuffer()), input)
})

test.each([
  ['application/pdf', new TextEncoder().encode('<html>bad gateway</html>')],
  ['application/zip', new TextEncoder().encode('PKXX fake ZIP')],
  ['image/png', new TextEncoder().encode('PNG-not-actually-valid')],
  ['image/jpeg', new Uint8Array([0xff, 0xd8, 0x00, 0])],
  ['image/webp', new TextEncoder().encode('RIFFxxxxFAKE-data')],
  ['application/pdf', new TextEncoder().encode('%PDF')],
])('rejects invalid %s signatures, including truncated headers', async (type, content) => {
  await assert.rejects(
    verifyConversionSignature(new Blob([new Uint8Array(content)]).stream(), type),
    /does not match its declared file type/,
  )
})

test('invalid upstream PDF content is rejected before sending successful headers', async () => {
  const response = await proxyConversionRequest(
    requestFor(),
    async () =>
      new Response('<html>gateway fallback</html>', {
        headers: { 'Content-Type': 'application/pdf' },
      }),
  ).catch(proxyErrorResponse)
  assert.equal(response.status, 502)
  assert.match(await response.text(), /does not match its declared file type/)
})

test('a refused binary signature cancels a still-open upstream download', async () => {
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<html>'))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(verifyConversionSignature(source, 'application/pdf'), /file type/)
  assert.equal(cancelled, true)
})

test('cancel after signature replay propagates to the original upstream stream', async () => {
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('%PDF-1.7'))
    },
    cancel() {
      cancelled = true
    },
  })
  const verified = await verifyConversionSignature(source, 'application/pdf')
  const reader = verified.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), '%PDF-1.7')
  await reader.cancel()
  assert.equal(cancelled, true)
})

test('metadata JSON does not require a binary signature', async () => {
  const data = '{"source.pdf":{"PageCount":1}}'
  const stream = new Blob([data]).stream()
  assert.equal(
    await new Response(await verifyConversionSignature(stream, 'application/json')).text(),
    data,
  )
})
