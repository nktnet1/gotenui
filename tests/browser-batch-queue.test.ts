import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BrowserBatchQueuePanel } from '#/components/browser-batch-queue'
import {
  type BatchInput,
  BrowserBatchQueue,
  MAX_BATCH_CONCURRENT,
  MAX_BATCH_JOBS,
  MAX_BATCH_UPLOAD_BYTES,
} from '#/lib/browser-batch-queue'
import type { ConversionResult } from '#/lib/gotenberg-client'

function input(): BatchInput {
  return {
    candidate: {
      operation: 'url-pdf',
      fields: { url: 'https://example.com' },
      advanced: {},
    },
    connection: { kind: 'browser', url: 'http://localhost:3000', authorization: 'Bearer secret' },
    files: [],
    auxiliary: [],
    postFiles: {},
  }
}

const pdf = (name = 'output.pdf'): ConversionResult => ({
  mode: 'download',
  name,
  type: 'application/pdf',
  blob: new Blob(['%PDF-1.7\n']),
  trace: 'test-trace',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function tick() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function queueWith(
  executor: ConstructorParameters<typeof BrowserBatchQueue>[0],
  onCompleted?: ConstructorParameters<typeof BrowserBatchQueue>[1],
) {
  const revoked: string[] = []
  const queue = new BrowserBatchQueue(
    executor,
    onCompleted,
    (blob) => `blob:sample-${blob.size}-${crypto.randomUUID()}`,
    (url) => revoked.push(url),
  )
  return { queue, revoked }
}

describe('browser-managed batch queue', () => {
  it('starts only when requested and never exceeds the two-request concurrency limit', async () => {
    expect(MAX_BATCH_CONCURRENT).toBe(2)
    const waiting = Array.from({ length: 3 }, () => deferred<ConversionResult>())
    let created = 0
    const execute = vi.fn(() => waiting[created++]?.promise as Promise<ConversionResult>)
    const { queue } = queueWith(execute)
    for (let i = 0; i < 3; i++) queue.enqueue(input())
    expect(execute).not.toHaveBeenCalled()
    queue.start()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual([
      'running',
      'running',
      'queued',
    ])
    waiting[0]?.resolve(pdf())
    await tick()
    expect(execute).toHaveBeenCalledTimes(3)
    waiting[1]?.resolve(pdf('two.pdf'))
    waiting[2]?.resolve(pdf('three.pdf'))
    await tick()
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
    queue.dispose()
  })

  it('pauses dispatch of queued jobs without cancelling requests already in flight', async () => {
    const held = deferred<ConversionResult>()
    const execute = vi.fn(() => held.promise)
    const { queue } = queueWith(execute)
    queue.enqueue(input())
    queue.start()
    queue.pause()
    queue.enqueue(input())
    held.resolve(pdf())
    await tick()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual(['completed', 'queued'])
    queue.dispose()
  })

  it('keeps each selected connection and payload independent of later edits', async () => {
    const request = input()
    const originalFile = new File(['data'], 'style.css')
    request.auxiliary = [originalFile]
    request.candidate = {
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      source: '<p>original</p>',
    }
    let captured!: BatchInput
    const { queue } = queueWith(async (value) => {
      captured = value
      return pdf()
    })
    queue.enqueue(request)
    ;(request.connection as { authorization?: string }).authorization = 'Bearer changed'
    ;(request.candidate as { source: string }).source = '<p>edited</p>'
    request.auxiliary.length = 0
    queue.start()
    await tick()
    expect(captured.connection).toMatchObject({ authorization: 'Bearer secret' })
    expect(captured.candidate).toMatchObject({ source: '<p>original</p>' })
    expect(captured.auxiliary).toEqual([originalFile])
    queue.dispose()
  })

  it('pins the chosen server-managed connection for each queued request', async () => {
    const selected = input()
    selected.connection = { kind: 'server', id: 'primary' }
    const second = input()
    second.connection = { kind: 'server', id: 'secondary' }
    const requests: string[] = []
    const { queue } = queueWith(async (request) => {
      if (request.connection.kind === 'server') requests.push(request.connection.id)
      return pdf()
    })
    queue.enqueue(selected)
    queue.enqueue(second)
    selected.connection = { kind: 'server', id: 'changed' }
    queue.start()
    await tick()
    expect(requests).toEqual(['primary', 'secondary'])
    queue.dispose()
  })

  it('does not include credentials, source files or remote URLs in public snapshots', () => {
    const { queue } = queueWith(async () => pdf())
    const request = input()
    queue.enqueue(request)
    const display = JSON.stringify(queue.getSnapshot())
    expect(display).not.toContain('secret')
    expect(display).not.toContain('example.com')
    expect(display).not.toContain('localhost')
    queue.dispose()
  })

  it('validates jobs before queueing and does not execute invalid operations', () => {
    const execute = vi.fn(async () => pdf())
    const { queue } = queueWith(execute)
    expect(() => queue.enqueue({ ...input(), candidate: { operation: 'other' } })).toThrow()
    expect(() =>
      queue.enqueue({ ...input(), candidate: { operation: 'merge', fields: {}, advanced: {} } }),
    ).toThrow()
    expect(queue.getSnapshot().jobs).toHaveLength(0)
    expect(execute).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('enforces the queue length cap while retaining failed or completed entries', () => {
    const { queue } = queueWith(async () => pdf())
    for (let i = 0; i < MAX_BATCH_JOBS; i++) queue.enqueue(input())
    expect(() => queue.enqueue(input())).toThrow(`up to ${MAX_BATCH_JOBS}`)
    queue.cancel(1)
    queue.remove(1)
    expect(() => queue.enqueue(input())).not.toThrow()
    queue.dispose()
  })

  it('enforces an aggregate upload-memory budget across valid queued jobs', () => {
    const { queue } = queueWith(async () => pdf())
    expect(MAX_BATCH_UPLOAD_BYTES).toBe(32_000_000)
    for (let i = 0; i < 8; i++) {
      const request = input()
      request.candidate = { operation: 'office-pdf', fields: {}, advanced: {} }
      const file = new File([], `document-${i}.docx`)
      Object.defineProperty(file, 'size', { value: 3_900_000 })
      request.files = [file]
      queue.enqueue(request)
    }
    const overflow = input()
    overflow.candidate = { operation: 'office-pdf', fields: {}, advanced: {} }
    const file = new File([], 'overflow.docx')
    Object.defineProperty(file, 'size', { value: 3_900_000 })
    overflow.files = [file]
    expect(() => queue.enqueue(overflow)).toThrow('32 MB browser memory budget')
    queue.dispose()
  })

  it('counts document source text alongside uploads in the aggregate memory budget', () => {
    const { queue } = queueWith(async () => pdf())
    const content = `<p>${'x'.repeat(290_000)}</p>`
    for (let i = 0; i < 8; i++) {
      const request = input()
      request.candidate = { operation: 'html-pdf', fields: {}, advanced: {}, source: content }
      const asset = new File([], `asset-${i}.css`)
      Object.defineProperty(asset, 'size', { value: 3_600_000 })
      request.auxiliary = [asset]
      queue.enqueue(request)
    }
    const ninth = input()
    ninth.candidate = { operation: 'html-pdf', fields: {}, advanced: {}, source: content }
    const asset = new File([], 'asset-8.css')
    Object.defineProperty(asset, 'size', { value: 3_600_000 })
    ninth.auxiliary = [asset]
    expect(() => queue.enqueue(ninth)).toThrow('32 MB browser memory budget')
    queue.dispose()
  })

  it('releases successful request inputs from the aggregate budget', async () => {
    const held = deferred<ConversionResult>()
    const { queue } = queueWith(async () => held.promise)
    for (let i = 0; i < 8; i++) {
      const request = input()
      request.candidate = { operation: 'office-pdf', fields: {}, advanced: {} }
      const file = new File([], `large-${i}.docx`)
      Object.defineProperty(file, 'size', { value: 3_900_000 })
      request.files = [file]
      queue.enqueue(request)
    }
    queue.start()
    held.resolve(pdf())
    await tick()
    const extra = input()
    extra.candidate = { operation: 'office-pdf', fields: {}, advanced: {} }
    const file = new File([], 'extra.docx')
    Object.defineProperty(file, 'size', { value: 3_900_000 })
    extra.files = [file]
    expect(() => queue.enqueue(extra)).not.toThrow()
    queue.dispose()
  })

  it('bounds completed Blob retention while keeping earlier results downloadable', async () => {
    let called = 0
    const { queue, revoked } = queueWith(async () => {
      const blob = new Blob(['%PDF-1.7'])
      Object.defineProperty(blob, 'size', { value: called++ === 0 ? 200_000_000 : 1 })
      return { mode: 'download', blob, type: 'application/pdf', name: 'result.pdf' }
    })
    queue.enqueue(input())
    queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual(['completed', 'failed'])
    expect(queue.getSnapshot().jobs[1]?.error).toContain('200 MB browser memory budget')
    expect(queue.getSnapshot().jobs[0]?.url).toBeDefined()
    expect(revoked).toHaveLength(0)
    queue.dispose()
    expect(revoked).toHaveLength(1)
  })

  it('cancels queued jobs without executing them, and supports retry', async () => {
    const execute = vi.fn(async () => pdf())
    const { queue } = queueWith(execute)
    const id = queue.enqueue(input())
    queue.cancel(id)
    expect(queue.getSnapshot().jobs[0]?.status).toBe('cancelled')
    queue.start()
    expect(execute).not.toHaveBeenCalled()
    queue.retry(id)
    await tick()
    expect(queue.getSnapshot().jobs[0]?.status).toBe('completed')
    queue.dispose()
  })

  it('aborts active jobs and does not convert a late response into a completed job', async () => {
    const held = deferred<ConversionResult>()
    const execute = vi.fn((_value: BatchInput, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false)
      return held.promise
    })
    const completed = vi.fn()
    const { queue } = queueWith(execute, completed)
    const id = queue.enqueue(input())
    queue.start()
    queue.cancel(id)
    held.resolve(pdf())
    await tick()
    expect(queue.getSnapshot().jobs[0]?.status).toBe('cancelled')
    expect(queue.getSnapshot().jobs[0]?.url).toBeUndefined()
    expect(completed).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('does not issue a network request when a subscriber cancels during dispatch', async () => {
    const execute = vi.fn(async () => pdf())
    const { queue } = queueWith(execute)
    const id = queue.enqueue(input())
    queue.subscribe(() => {
      if (queue.getSnapshot().jobs[0]?.status === 'running') queue.cancel(id)
    })
    queue.start()
    await tick()
    expect(execute).not.toHaveBeenCalled()
    expect(queue.getSnapshot().jobs[0]?.status).toBe('cancelled')
    queue.dispose()
  })

  it('cancel-all stops dispatch, aborts both active jobs and cancels waiting entries', async () => {
    const held = deferred<ConversionResult>()
    const signals: AbortSignal[] = []
    const { queue } = queueWith(async (_request, signal) => {
      signals.push(signal)
      return held.promise
    })
    for (let index = 0; index < 3; index++) queue.enqueue(input())
    queue.start()
    expect(signals).toHaveLength(2)
    queue.cancelAll()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(queue.getSnapshot().active).toBe(false)
    held.resolve(pdf())
    await tick()
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    queue.dispose()
  })

  it('retries a failed job without retaining the previous error', async () => {
    let calls = 0
    const { queue } = queueWith(async () => {
      if (calls++ === 0) throw new Error('upstream rejected')
      return pdf()
    })
    const id = queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({
      status: 'failed',
      error: 'upstream rejected',
    })
    queue.retry(id)
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({ status: 'completed' })
    expect(queue.getSnapshot().jobs[0]?.error).toBeUndefined()
    queue.dispose()
  })

  it('marks webhooks accepted without treating them as downloaded or completed', async () => {
    const completed = vi.fn()
    const { queue } = queueWith(
      async () => ({ mode: 'webhook', status: 204, trace: 'abc' }),
      completed,
    )
    const id = queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({
      id,
      status: 'accepted',
      webhookStatus: 204,
    })
    expect(queue.getSnapshot().jobs[0]?.url).toBeUndefined()
    expect(completed).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('publishes immutable snapshots and reports downloads to session activity', async () => {
    const listener = vi.fn()
    const completed = vi.fn()
    const { queue } = queueWith(async () => pdf('report.pdf'), completed)
    const unsubscribe = queue.subscribe(listener)
    const before = queue.getSnapshot()
    queue.enqueue(input())
    queue.start()
    await tick()
    expect(before.jobs).toHaveLength(0)
    expect(queue.getSnapshot().jobs[0]).toMatchObject({ status: 'completed', name: 'report.pdf' })
    expect(listener).toHaveBeenCalled()
    expect(completed).toHaveBeenCalledOnce()
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ name: 'report.pdf' })
    unsubscribe()
    queue.dispose()
  })

  it('revokes completed result URLs when removed or disposed', async () => {
    const { queue, revoked } = queueWith(async () => pdf())
    const first = queue.enqueue(input())
    queue.start()
    await tick()
    const firstUrl = queue.getSnapshot().jobs[0]?.url
    assert.ok(firstUrl)
    queue.remove(first)
    expect(revoked).toEqual([firstUrl])
    queue.enqueue(input())
    await tick()
    const secondUrl = queue.getSnapshot().jobs[0]?.url
    queue.dispose()
    expect(revoked).toContain(secondUrl)
    expect(queue.getSnapshot().jobs).toHaveLength(0)
  })

  it('clears finished entries and revokes downloads without cancelling waiting work', async () => {
    const { queue, revoked } = queueWith(async () => pdf())
    const first = queue.enqueue(input())
    queue.start()
    await tick()
    const url = queue.getSnapshot().jobs[0]?.url
    queue.pause()
    const second = queue.enqueue(input())
    await tick()
    queue.clearFinished()
    expect(queue.getSnapshot().jobs.map(({ id }) => id)).toEqual([second])
    expect(queue.getSnapshot().jobs[0]?.status).toBe('queued')
    expect(revoked).toEqual([url])
    expect(first).not.toBe(second)
    queue.dispose()
  })

  it('prevents late completions and notifications after the queue is disposed', async () => {
    const held = deferred<ConversionResult>()
    const completed = vi.fn()
    const { queue, revoked } = queueWith(async () => held.promise, completed)
    queue.enqueue(input())
    queue.start()
    queue.dispose()
    held.resolve(pdf())
    await tick()
    expect(completed).not.toHaveBeenCalled()
    expect(revoked).toEqual([])
  })

  it('shows visible controls for each relevant status and labels webhook acceptance accurately', async () => {
    const { queue } = queueWith(async () => ({ mode: 'webhook', status: 202 }))
    queue.enqueue(input())
    let markup = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
    expect(markup).toContain('Start queue')
    expect(markup).toContain('Queued')
    queue.start()
    await tick()
    markup = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
    expect(markup).toContain('Webhook accepted')
    expect(markup).toContain('delivery unconfirmed')
    expect(markup).toContain('Clear finished')
    queue.dispose()
  })
})
