import assert from 'node:assert/strict'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BatchInput, BrowserBatchQueue } from '#/lib/browser-batch-queue'

type SentRequest = { path: string; init: RequestInit; headers: Headers; form: FormData }

const pdfResponse = (name: string, trace: string) =>
  new Response('%PDF-1.7\n', {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name}"`,
      'Gotenberg-Trace': trace,
    },
  })

function captureRequest(path: RequestInfo | URL, init?: RequestInit): SentRequest {
  const form = init?.body
  assert.equal(String(path), '/api/gotenberg/convert')
  assert.ok(form instanceof FormData)
  assert.equal(init?.method, 'POST')
  assert.equal(init?.credentials, 'same-origin')
  return { path: String(path), init: init ?? {}, headers: new Headers(init?.headers), form }
}

function browserInput(url = 'https://docs.example.test/first'): BatchInput {
  return {
    connection: {
      kind: 'browser' as const,
      url: 'http://localhost:3000',
      authorization: 'Bearer browser-secret',
    },
    candidate: { operation: 'url-pdf', fields: { url }, advanced: {} },
    files: [],
    auxiliary: [],
    postFiles: {},
  }
}

function makeQueue() {
  const revoked: string[] = []
  const queue = new BrowserBatchQueue(
    undefined,
    undefined,
    (blob) => `blob:batch-test-${crypto.randomUUID()}-${blob.size}`,
    (url) => revoked.push(url),
  )
  return { queue, revoked }
}

async function settle(queue: BrowserBatchQueue, statuses: string[]) {
  await vi.waitFor(
    () => expect(queue.getSnapshot().jobs.map((job) => job.status)).toEqual(statuses),
    { timeout: 1_000 },
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('browser batch queue to same-origin API transport', () => {
  it('sends isolated browser and server connection headers using enqueued snapshots', async () => {
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
        const request = captureRequest(path, init)
        requests.push(request)
        return pdfResponse(`document-${requests.length}.pdf`, `trace-${requests.length}`)
      }),
    )
    const { queue, revoked } = makeQueue()
    try {
      const first = browserInput()
      const second = browserInput('https://docs.example.test/second')
      second.connection = { ...first.connection }
      const server = {
        ...second,
        connection: { kind: 'server' as const, id: 'private-office' },
      }
      queue.enqueue(first)
      queue.enqueue(server)
      if (first.connection.kind === 'browser') {
        first.connection.authorization = 'Bearer changed-after-enqueue'
      }
      ;(first.candidate as { fields: { url: string } }).fields.url =
        'https://docs.example.test/changed'
      queue.start()
      await settle(queue, ['completed', 'completed'])
      expect(requests).toHaveLength(2)
      const [browser, managed] = requests
      assert.ok(browser && managed)
      expect(browser.headers.get('X-Gotenberg-Url')).toBe('http://localhost:3000')
      expect(browser.headers.get('X-Gotenui-Upstream-Authorization')).toBe('Bearer browser-secret')
      expect(browser.headers.has('X-Gotenui-Connection-Id')).toBe(false)
      expect(managed.headers.get('X-Gotenui-Connection-Id')).toBe('private-office')
      expect(managed.headers.has('X-Gotenui-Upstream-Authorization')).toBe(false)
      expect(managed.headers.has('X-Gotenberg-Url')).toBe(false)
      expect(browser.headers.has('Cookie')).toBe(false)
      expect(managed.headers.has('Cookie')).toBe(false)
      expect(JSON.parse(String(browser.form.get('payload'))).fields.url).toBe(
        'https://docs.example.test/first',
      )
      expect(JSON.parse(String(managed.form.get('payload'))).fields.url).toBe(
        'https://docs.example.test/second',
      )
      expect(queue.getSnapshot().jobs.map((job) => job.trace)).toEqual(['trace-1', 'trace-2'])
      expect(JSON.stringify(queue.getSnapshot())).not.toContain('browser-secret')
      expect(JSON.stringify(queue.getSnapshot())).not.toContain('docs.example.test')
      expect(revoked).toEqual([])
    } finally {
      queue.dispose()
      expect(revoked).toHaveLength(2)
    }
  })

  it('forwards snapshot files and source through the same-origin multipart contract', async () => {
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
        requests.push(captureRequest(path, init))
        return pdfResponse('html.pdf', 'trace-source')
      }),
    )
    const { queue } = makeQueue()
    try {
      const request = browserInput()
      request.candidate = {
        operation: 'html-pdf',
        fields: {},
        advanced: {},
        source: '<h1>Original</h1>',
      }
      const css = new File(['body { color: blue }'], 'style.css', { type: 'text/css' })
      request.auxiliary = [css]
      queue.enqueue(request)
      request.auxiliary.length = 0
      ;(request.candidate as { source: string }).source = '<h1>Changed</h1>'
      queue.start()
      await settle(queue, ['completed'])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.form.getAll('auxiliary')).toEqual([css])
      expect(requests[0]?.form.has('files')).toBe(false)
      expect(JSON.parse(String(requests[0]?.form.get('payload'))).source).toBe('<h1>Original</h1>')
    } finally {
      queue.dispose()
    }
  })

  it('distinguishes webhook acceptance from completion using the real request client', async () => {
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
        requests.push(captureRequest(path, init))
        return new Response(null, { status: 204, headers: { 'Gotenberg-Trace': 'queued-trace' } })
      }),
    )
    const { queue, revoked } = makeQueue()
    try {
      const request = browserInput()
      request.candidate = {
        ...(request.candidate as Record<string, unknown>),
        webhook: { url: 'https://receiver.example.test/success', method: 'POST' },
      }
      queue.enqueue(request)
      queue.start()
      await settle(queue, ['accepted'])
      expect(queue.getSnapshot().jobs[0]).toMatchObject({
        status: 'accepted',
        trace: 'queued-trace',
        webhookStatus: 204,
      })
      expect(queue.getSnapshot().jobs[0]?.url).toBeUndefined()
      expect(JSON.parse(String(requests[0]?.form.get('payload'))).webhook.url).toBe(
        'https://receiver.example.test/success',
      )
      expect(revoked).toHaveLength(0)
    } finally {
      queue.dispose()
    }
  })

  it('isolates an aborted request while an independent batch job finishes', async () => {
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
        const request = captureRequest(path, init)
        requests.push(request)
        if (requests.length === 2) return Promise.resolve(pdfResponse('kept.pdf', 'kept-trace'))
        return new Promise<Response>((_resolve, reject) => {
          assert.ok(init?.signal)
          const signal = init.signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }),
    )
    const { queue } = makeQueue()
    try {
      const stopped = queue.enqueue(browserInput())
      queue.enqueue(browserInput('https://docs.example.test/second'))
      queue.start()
      await settle(queue, ['running', 'completed'])
      queue.cancel(stopped)
      await settle(queue, ['cancelled', 'completed'])
      expect(requests[0]?.init.signal?.aborted).toBe(true)
      expect(requests[1]?.init.signal?.aborted).toBe(false)
      expect(queue.getSnapshot().jobs[0]?.url).toBeUndefined()
      expect(queue.getSnapshot().jobs[1]?.name).toBe('kept.pdf')
    } finally {
      queue.dispose()
    }
  })

  it('retries a rejected upstream response without changing its original connection', async () => {
    let calls = 0
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
        requests.push(captureRequest(path, init))
        if (calls++ === 0) {
          return new Response('Authorization required.', {
            status: 401,
            headers: { 'Gotenberg-Trace': 'rejected-trace' },
          })
        }
        return pdfResponse('retried.pdf', 'success-trace')
      }),
    )
    const { queue } = makeQueue()
    try {
      const request = browserInput()
      const id = queue.enqueue(request)
      if (request.connection.kind === 'browser') request.connection.authorization = 'Bearer changed'
      queue.start()
      await settle(queue, ['failed'])
      expect(queue.getSnapshot().jobs[0]?.error).toContain('Authorization required.')
      expect(queue.getSnapshot().jobs[0]?.error).toContain('rejected-trace')
      queue.retry(id)
      await settle(queue, ['completed'])
      expect(requests).toHaveLength(2)
      expect(requests.map((r) => r.headers.get('X-Gotenui-Upstream-Authorization'))).toEqual([
        'Bearer browser-secret',
        'Bearer browser-secret',
      ])
      expect(queue.getSnapshot().jobs[0]?.trace).toBe('success-trace')
    } finally {
      queue.dispose()
    }
  })

  it('keeps queued overlays and attachments in their dedicated multipart upload fields', async () => {
    const requests: SentRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
        requests.push(captureRequest(path, init))
        return pdfResponse('processed.pdf', 'post-process-trace')
      }),
    )
    const { queue } = makeQueue()
    try {
      const request = browserInput()
      const image = new File(['image bytes'], 'logo.png', { type: 'image/png' })
      const attachment = new File(['receipt'], 'receipt.txt', { type: 'text/plain' })
      request.candidate = {
        ...(request.candidate as Record<string, unknown>),
        postProcess: {
          watermark: { source: 'image', expression: 'logo.png' },
          flatten: true,
        },
      }
      request.postFiles = { watermark: image, embeds: [attachment] }
      queue.enqueue(request)
      request.postFiles.embeds?.pop()
      request.postFiles.watermark = undefined
      queue.start()
      await settle(queue, ['completed'])
      const form = requests[0]?.form
      assert.ok(form)
      expect(form.getAll('watermark')).toEqual([image])
      expect(form.getAll('embeds')).toEqual([attachment])
      expect(form.has('postProcess')).toBe(false)
      expect(form.has('watermarkSource')).toBe(false)
      expect(JSON.parse(String(form.get('payload'))).postProcess).toMatchObject({
        watermark: { source: 'image', expression: 'logo.png' },
        flatten: true,
      })
    } finally {
      queue.dispose()
    }
  })
})
