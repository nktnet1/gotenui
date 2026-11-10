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

const pdf = (name = 'output.pdf'): Extract<ConversionResult, { mode: 'download' }> => ({
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

  it('continues dispatching after clearing finished jobs until explicitly paused', async () => {
    const execute = vi.fn(async () => pdf())
    const { queue } = queueWith(execute)
    queue.enqueue(input())
    queue.start()
    await tick()
    queue.clearFinished()
    expect(queue.getSnapshot()).toMatchObject({ active: true, jobs: [] })

    queue.enqueue(input())
    // A started queue launches on enqueue, rather than remaining "1 waiting".
    expect(queue.getSnapshot().jobs[0]?.status).toBe('running')
    await tick()
    queue.pause()
    queue.clearFinished()
    queue.enqueue(input())
    expect(queue.getSnapshot()).toMatchObject({
      active: false,
      jobs: [{ status: 'queued' }],
    })
    queue.start()
    expect(queue.getSnapshot().jobs[0]?.status).toBe('running')
    await tick()
    expect(execute).toHaveBeenCalledTimes(3)
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

  it('retains distinct v8 and v9 targets while pending jobs wait for a free slot', async () => {
    const pending = [deferred<ConversionResult>(), deferred<ConversionResult>()]
    const targets: string[] = []
    const { queue } = queueWith(async (value) => {
      const target = value.connection
      expect(target.kind).toBe('server')
      if (target.kind === 'server') targets.push(target.id)
      return pending[targets.length - 1]?.promise ?? pdf()
    })
    const first = input()
    first.connection = { kind: 'server', id: 'v8-production' }
    queue.enqueue(first)
    first.connection = { kind: 'server', id: 'v9-production' }
    const second = input()
    second.connection = first.connection
    queue.enqueue(second)
    const third = input()
    third.connection = { kind: 'server', id: 'v8-production' }
    queue.enqueue(third)
    queue.start()
    expect(targets).toEqual(['v8-production', 'v9-production'])
    third.connection = { kind: 'server', id: 'v9-production' }
    pending[0]?.resolve(pdf())
    await tick()
    expect(targets).toEqual(['v8-production', 'v9-production', 'v8-production'])
    pending[1]?.resolve(pdf())
    await tick()
    expect(queue.getSnapshot().jobs.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
    queue.dispose()
  })

  it('offers opt-in ZIP previews without exposing archive data in public job snapshots', async () => {
    const archive = new Blob(['PK\u0003\u0004 example archive'], { type: 'application/zip' })
    const pending = deferred<ConversionResult>()
    const { queue, revoked } = queueWith(async () => pending.promise)
    const id = queue.enqueue(input())
    expect(queue.getArchiveBlob(id)).toBeUndefined()
    queue.start()
    expect(queue.getArchiveBlob(id)).toBeUndefined()
    pending.resolve({ mode: 'download', type: 'application/zip', name: 'pages.zip', blob: archive })
    await tick()

    const job = queue.getSnapshot().jobs[0]
    expect(job).toMatchObject({ id, status: 'completed', type: 'application/zip' })
    expect(queue.getArchiveBlob(id)).toBe(archive)
    expect(Object.keys(job ?? {})).not.toContain('archive')
    const html = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
    expect(html).toContain('Download pages.zip')
    expect(html).toContain('View archive contents')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('example archive')
    expect(html).not.toContain('Archive files')

    queue.remove(id)
    expect(queue.getArchiveBlob(id)).toBeUndefined()
    expect(revoked).toEqual([job?.url])
    queue.dispose()
  })

  it.each(['image/png', 'image/jpeg', 'image/webp'])(
    'offers an opt-in %s preview using the completed image download URL',
    async (type) => {
      const { queue, revoked } = queueWith(async () => ({
        mode: 'download',
        type,
        name: `rendered.${type.split('/')[1]}`,
        blob: new Blob(['image bytes'], { type }),
      }))
      const id = queue.enqueue(input())
      queue.start()
      await tick()
      const job = queue.getSnapshot().jobs[0]
      expect(job).toMatchObject({ id, status: 'completed', type })
      const markup = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
      expect(markup).toContain(`Download ${job?.name}`)
      expect(markup).toContain('Preview image')
      expect(markup).toContain('aria-expanded="false"')
      expect(markup).not.toContain('<img')
      expect(queue.getArchiveBlob(id)).toBeUndefined()
      queue.clearFinished()
      expect(revoked).toEqual([job?.url])
      expect(renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))).not.toContain(
        'Preview image',
      )
      queue.dispose()
    },
  )

  it('does not preview non-raster, failed, or cancelled image downloads', async () => {
    const { queue } = queueWith(async () => ({
      mode: 'download',
      type: 'image/svg+xml',
      name: 'unexpected.svg',
      blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    }))
    queue.enqueue(input())
    queue.start()
    await tick()
    expect(renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))).not.toContain(
      'Preview image',
    )
    queue.dispose()

    const pending = deferred<ConversionResult>()
    const cancelled = queueWith(async () => pending.promise)
    const id = cancelled.queue.enqueue(input())
    cancelled.queue.start()
    cancelled.queue.cancel(id)
    pending.resolve({
      mode: 'download',
      type: 'image/png',
      name: 'late.png',
      blob: new Blob(['x']),
    })
    await tick()
    expect(
      renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue: cancelled.queue })),
    ).not.toContain('Preview image')
    cancelled.queue.dispose()
  })

  it('does not offer ZIP previews for PDF outputs, cancelled jobs, or disposed queues', async () => {
    const pdfJob = queueWith(async () => pdf())
    const pdfId = pdfJob.queue.enqueue(input())
    pdfJob.queue.start()
    await tick()
    expect(pdfJob.queue.getArchiveBlob(pdfId)).toBeUndefined()
    expect(
      renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue: pdfJob.queue })),
    ).not.toContain('View archive contents')
    pdfJob.queue.dispose()

    const pending = deferred<ConversionResult>()
    const { queue } = queueWith(async () => pending.promise)
    const id = queue.enqueue(input())
    queue.start()
    queue.cancel(id)
    pending.resolve({
      mode: 'download',
      type: 'application/zip',
      name: 'late.zip',
      blob: new Blob(['late']),
    })
    await tick()
    expect(queue.getArchiveBlob(id)).toBeUndefined()
    expect(renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))).not.toContain(
      'View archive contents',
    )
    queue.dispose()
    expect(queue.getArchiveBlob(id)).toBeUndefined()
  })

  it('releases completed ZIP preview references when clearing finished jobs', async () => {
    const { queue } = queueWith(async () => ({
      mode: 'download',
      type: 'application/zip',
      name: 'result.zip',
      blob: new Blob(['PK\u0003\u0004 zip']),
    }))
    const id = queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getArchiveBlob(id)).toBeInstanceOf(Blob)
    queue.clearFinished()
    expect(queue.getArchiveBlob(id)).toBeUndefined()
    queue.dispose()
  })

  it('warns about non-compliant v9 validation results but keeps the report downloadable', async () => {
    const completed = vi.fn()
    const result: ConversionResult = {
      mode: 'download',
      name: 'validation.json',
      type: 'application/json',
      blob: new Blob(
        [
          JSON.stringify({
            'customer-a.pdf': {
              compliant: false,
              profile: ['PDF/A-2b'],
              violations: [{ description: 'Missing output intent' }],
            },
            'customer-b.pdf': { compliant: true, profile: ['PDF/A-2b'], violations: [] },
          }),
        ],
        { type: 'application/json' },
      ),
    }
    const { queue } = queueWith(async () => result, completed)
    const request = input()
    request.candidate = { operation: 'pdf-validate', fields: { profile: 'PDF/A-2b' }, advanced: {} }
    request.files = [new File(['%PDF-1.7\n'], 'document.pdf')]
    queue.enqueue(request)
    queue.start()
    await tick()
    const job = queue.getSnapshot().jobs[0]
    expect(job).toMatchObject({
      status: 'completed',
      review:
        'PDF validation found 1 non-compliant document(s) out of 2. Review the downloaded JSON report.',
      name: 'validation.json',
    })
    expect(job?.url).toMatch(/^blob:/)
    expect(JSON.stringify(job)).not.toContain('customer-a.pdf')
    expect(JSON.stringify(job)).not.toContain('Missing output intent')
    expect(completed).toHaveBeenCalledOnce()
    const html = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Review required')
    expect(html).toContain('Download validation.json')
    queue.dispose()
  })

  it('does not warn on compliant PDF validation results', async () => {
    const { queue } = queueWith(async () => ({
      mode: 'download',
      name: 'report.json',
      type: 'application/json',
      blob: new Blob([
        JSON.stringify({
          'document.pdf': { compliant: true, profile: 'PDF/A-2b', violations: [] },
        }),
      ]),
    }))
    const request = input()
    request.candidate = { operation: 'pdf-validate', fields: { profile: 'PDF/A-2b' }, advanced: {} }
    request.files = [new File(['%PDF-1.7\n'], 'document.pdf')]
    queue.enqueue(request)
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({ status: 'completed' })
    expect(queue.getSnapshot().jobs[0]?.review).toBeUndefined()
    expect(renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))).not.toContain(
      'Review required',
    )
    queue.dispose()
  })

  it('keeps compliant Factur-X warning reports downloadable and marks the batch for review', async () => {
    const { queue } = queueWith(async () => ({
      mode: 'download',
      name: 'report.json',
      type: 'application/json',
      blob: new Blob([
        JSON.stringify({
          'invoice.pdf': {
            compliant: true,
            profile: 'Factur-X',
            violations: [{ description: 'Optional rule warning', severity: 'warning' }],
          },
        }),
      ]),
    }))
    const request = input()
    request.candidate = { operation: 'pdf-validate', fields: { profile: 'Factur-X' }, advanced: {} }
    request.files = [new File(['%PDF-1.7\n'], 'invoice.pdf')]
    queue.enqueue(request)
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({
      status: 'completed',
      review:
        'PDF validation found non-fatal findings in 1 compliant document(s). Review the downloaded JSON report.',
    })
    expect(renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))).toContain(
      'Review required',
    )
    queue.dispose()
  })

  it('flags unparseable, oversized and unreadable validation reports without failing the download', async () => {
    for (const scenario of ['invalid', 'oversized', 'unreadable'] as const) {
      const blob = new Blob([scenario === 'invalid' ? '{not-json' : '{"ok":true}'])
      if (scenario === 'oversized') Object.defineProperty(blob, 'size', { value: 129_000 })
      if (scenario === 'unreadable') {
        Object.defineProperty(blob, 'text', {
          value: () => Promise.reject(new Error('read failed')),
        })
      }
      const { queue } = queueWith(async () => ({
        mode: 'download',
        name: 'report.json',
        type: 'application/json',
        blob,
      }))
      const request = input()
      request.candidate = {
        operation: 'pdf-validate',
        fields: { profile: 'PDF/A-2b' },
        advanced: {},
      }
      request.files = [new File(['%PDF-1.7\n'], 'document.pdf')]
      queue.enqueue(request)
      queue.start()
      await tick()
      expect(queue.getSnapshot().jobs[0]).toMatchObject({
        status: 'completed',
        review: 'PDF validation could not be summarised. Review the downloaded JSON report.',
      })
      expect(queue.getSnapshot().jobs[0]?.url).toBeDefined()
      queue.dispose()
    }
  })

  it('does not publish a late validation result after the user cancels the batch job', async () => {
    const validation = deferred<string>()
    const blob = new Blob(['placeholder'], { type: 'application/json' })
    Object.defineProperty(blob, 'text', { value: () => validation.promise })
    const completed = vi.fn()
    const { queue } = queueWith(
      async () => ({ mode: 'download', name: 'validation.json', type: 'application/json', blob }),
      completed,
    )
    const request = input()
    request.candidate = {
      operation: 'pdf-validate',
      fields: { profile: 'PDF/A-2b' },
      advanced: {},
    }
    request.files = [new File(['%PDF-1.7\n'], 'document.pdf')]
    const id = queue.enqueue(request)
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]?.status).toBe('running')
    queue.cancel(id)
    validation.resolve(
      JSON.stringify({
        'document.pdf': { compliant: true, profile: 'PDF/A-2b', violations: [] },
      }),
    )
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({ status: 'cancelled' })
    expect(queue.getSnapshot().jobs[0]?.url).toBeUndefined()
    expect(completed).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('preserves remediation warning counts on completed batch downloads', async () => {
    const { queue } = queueWith(async () => ({
      ...pdf(),
      remediation: { residual: 2, rolledBack: 1 },
    }))
    queue.enqueue(input())
    queue.start()
    await tick()
    const job = queue.getSnapshot().jobs[0]
    expect(job).toMatchObject({
      status: 'completed',
      review:
        'PDF remediation reported 2 unresolved violation(s) and 1 rolled-back fix(es). Validate the downloaded output.',
    })
    expect(job?.url).toBeDefined()
    queue.dispose()
  })

  it('keeps incomplete remediation diagnostics visible on a completed batch download', async () => {
    const { queue } = queueWith(async () => ({
      ...pdf(),
      mode: 'download' as const,
      remediation: { residual: 0, rolledBack: 0, incomplete: true },
    }))
    queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({
      status: 'completed',
      review: 'PDF remediation diagnostics were incomplete. Validate the downloaded output.',
    })
    const html = renderToStaticMarkup(createElement(BrowserBatchQueuePanel, { queue }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Review required')
    queue.dispose()
  })

  it('does not suggest that clean remediation headers themselves certify compliance', async () => {
    const { queue } = queueWith(async () => ({
      ...pdf(),
      remediation: { residual: 0, rolledBack: 0 },
    }))
    queue.enqueue(input())
    queue.start()
    await tick()
    expect(queue.getSnapshot().jobs[0]).toMatchObject({ status: 'completed' })
    expect(queue.getSnapshot().jobs[0]?.review).toBeUndefined()
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

describe('conversion stage assets in the batch queue', () => {
  it('retains stage uploads when queued even if the form selection changes', async () => {
    const receipt = new File(['proof'], 'proof.txt')
    const conversion = input()
    conversion.candidate = {
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      source: '<html><body>batch pipeline</body></html>',
      conversionStages: '[{"op":"attach","file":"proof.txt"}]',
    }
    conversion.stageFiles = [receipt]
    let captured!: BatchInput
    const { queue } = queueWith(async (prepared) => {
      captured = prepared
      return pdf()
    })
    queue.enqueue(conversion)
    conversion.stageFiles.length = 0
    queue.start()
    await tick()
    expect(captured.stageFiles).toEqual([receipt])
    expect(queue.getSnapshot().jobs[0]?.status).toBe('completed')
    queue.dispose()
  })

  it('counts conversion stage uploads toward the queued memory budget', () => {
    const conversion = input()
    conversion.candidate = {
      operation: 'html-pdf',
      fields: {},
      advanced: {},
      source: '<html><body>batch pipeline</body></html>',
      conversionStages: '[{"op":"attach","file":"proof.txt"}]',
    }
    conversion.stageFiles = [new File([new Uint8Array(3_400_000)], 'proof.txt')]
    const { queue } = queueWith(async () => pdf())
    for (let i = 0; i < 9; i++) queue.enqueue(conversion)
    expect(() => queue.enqueue(conversion)).toThrow(/Batch inputs exceed/)
    queue.dispose()
  })
})
