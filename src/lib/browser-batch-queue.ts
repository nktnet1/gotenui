import type { ConnectionChoice } from '#/lib/connection-profiles'
import {
  type ConversionResult,
  convertWithGotenberg,
  MAX_UPLOAD_BYTES,
  REQUEST_TIMEOUT_MS,
} from '#/lib/gotenberg-client'
import type { PostProcessFiles } from '#/lib/pdf-post-processing'
import { type ConversionPayload, validateFiles, validatePayload } from '#/lib/validation'

export const MAX_BATCH_JOBS = 12
export const MAX_BATCH_CONCURRENT = 2
export const MAX_BATCH_UPLOAD_BYTES = 32_000_000
export const MAX_BATCH_RESULT_BYTES = 200_000_000

export type BatchStatus = 'queued' | 'running' | 'completed' | 'accepted' | 'failed' | 'cancelled'

export type BatchJob = {
  id: number
  operation: string
  status: BatchStatus
  elapsed?: number
  name?: string
  url?: string
  size?: number
  type?: string
  trace?: string
  webhookStatus?: 202 | 204
  error?: string
  aborting?: boolean
}

export type BatchSnapshot = { active: boolean; jobs: readonly BatchJob[] }

export type BatchInput = {
  connection: ConnectionChoice
  candidate: unknown
  files: File[]
  auxiliary: File[]
  postFiles: PostProcessFiles
}

type PreparedInput = Omit<BatchInput, 'candidate'> & { candidate: ConversionPayload }
type BatchExecutor = (input: PreparedInput, signal: AbortSignal) => Promise<ConversionResult>
type CompleteListener = (job: BatchJob) => void

type RecordEntry = {
  view: BatchJob
  input?: PreparedInput
  controller?: AbortController
}

function copiedPostFiles(files: PostProcessFiles): PostProcessFiles {
  return {
    watermark: Array.isArray(files.watermark) ? [...files.watermark] : files.watermark,
    stamp: Array.isArray(files.stamp) ? [...files.stamp] : files.stamp,
    embeds: files.embeds ? [...files.embeds] : undefined,
    facturxXml: files.facturxXml,
  }
}

function inputBytes(input: PreparedInput): number {
  const local = [
    ...input.files,
    ...input.auxiliary,
    ...(Array.isArray(input.postFiles.watermark)
      ? input.postFiles.watermark
      : input.postFiles.watermark
        ? [input.postFiles.watermark]
        : []),
    ...(Array.isArray(input.postFiles.stamp)
      ? input.postFiles.stamp
      : input.postFiles.stamp
        ? [input.postFiles.stamp]
        : []),
    ...(input.postFiles.embeds ?? []),
    ...(input.postFiles.facturxXml ? [input.postFiles.facturxXml] : []),
  ]
  return (
    local.reduce((total, file) => total + file.size, 0) +
    new Blob([JSON.stringify(input.candidate)]).size
  )
}

function prepareInput(input: BatchInput): PreparedInput {
  const { operation, payload } = validatePayload(input.candidate)
  validateFiles(operation, input.files, input.auxiliary, MAX_UPLOAD_BYTES, payload, input.postFiles)
  return {
    // Copy the values and collections now, not when the job starts. File bytes remain in memory.
    candidate: structuredClone(payload),
    connection: { ...input.connection },
    files: [...input.files],
    auxiliary: [...input.auxiliary],
    postFiles: copiedPostFiles(input.postFiles),
  }
}

async function executeConversion(
  input: PreparedInput,
  signal: AbortSignal,
): Promise<ConversionResult> {
  return convertWithGotenberg(
    input.connection,
    input.candidate,
    input.files,
    input.auxiliary,
    signal,
    input.postFiles,
  )
}

/** All inputs, including selected credentials, live only in this tab and are never serialized. */
export class BrowserBatchQueue {
  private records: RecordEntry[] = []
  private listeners = new Set<() => void>()
  private snapshot: BatchSnapshot = { active: false, jobs: [] }
  private nextId = 1
  private disposed = false

  constructor(
    private readonly execute: BatchExecutor = executeConversion,
    private readonly completed?: CompleteListener,
    private readonly createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revokeUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): BatchSnapshot => this.snapshot

  private emit() {
    if (this.disposed) return
    this.snapshot = {
      active: this.snapshot.active,
      jobs: this.records.map(({ view }) => ({ ...view })),
    }
    for (const listener of this.listeners) listener()
  }

  enqueue(input: BatchInput): number {
    if (this.disposed) throw new Error('The batch queue is no longer available.')
    if (this.records.length >= MAX_BATCH_JOBS) {
      throw new Error(
        `The batch queue holds up to ${MAX_BATCH_JOBS} jobs. Clear finished jobs first.`,
      )
    }
    const prepared = prepareInput(input)
    const pendingBytes = this.records.reduce(
      (total, record) => total + (record.input ? inputBytes(record.input) : 0),
      0,
    )
    if (inputBytes(prepared) + pendingBytes > MAX_BATCH_UPLOAD_BYTES) {
      throw new Error(
        'Batch inputs exceed the 32 MB browser memory budget. Clear finished jobs first.',
      )
    }
    const operation = validatePayload(prepared.candidate).operation
    const id = this.nextId++
    this.records.push({
      view: { id, operation: operation.title, status: 'queued' },
      input: prepared,
    })
    this.emit()
    this.pump()
    return id
  }

  start() {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, active: true }
    this.emit()
    this.pump()
  }

  pause() {
    this.snapshot = { ...this.snapshot, active: false }
    this.emit()
  }

  private pump() {
    if (!this.snapshot.active || this.disposed) return
    let running = this.records.filter((record) => record.controller).length
    for (const record of this.records) {
      if (running >= MAX_BATCH_CONCURRENT) break
      if (record.view.status !== 'queued') continue
      running++
      this.launch(record)
    }
  }

  private launch(record: RecordEntry) {
    const input = record.input
    if (!input) return
    const controller = new AbortController()
    record.controller = controller
    const started = performance.now()
    record.view = { id: record.view.id, operation: record.view.operation, status: 'running' }
    this.emit()
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = AbortSignal.any([controller.signal, timeout])
    void (async () => {
      try {
        // A synchronous subscriber may cancel a job during the running-state notification.
        if (this.disposed || signal.aborted) return
        const result = await this.execute(input, signal)
        if (this.disposed || controller.signal.aborted) return
        if (signal.aborted) {
          throw new Error('Gotenberg did not respond within three minutes.')
        }
        const elapsed = performance.now() - started
        if (result.mode === 'webhook') {
          record.view = {
            id: record.view.id,
            operation: record.view.operation,
            status: 'accepted',
            elapsed,
            trace: result.trace,
            webhookStatus: result.status,
          }
        } else {
          const retained = this.records.reduce(
            (total, entry) =>
              total + (entry.view.status === 'completed' ? (entry.view.size ?? 0) : 0),
            0,
          )
          if (retained + result.blob.size > MAX_BATCH_RESULT_BYTES) {
            throw new Error(
              'Batch downloads exceed the 200 MB browser memory budget. Download and clear completed jobs before retrying.',
            )
          }
          const url = this.createUrl(result.blob)
          record.view = {
            id: record.view.id,
            operation: record.view.operation,
            status: 'completed',
            elapsed,
            name: result.name,
            size: result.blob.size,
            type: result.type,
            trace: result.trace,
            url,
          }
          try {
            this.completed?.({ ...record.view })
          } catch {
            // UI activity callbacks must never change a completed conversion result.
          }
        }
        record.input = undefined
      } catch (error) {
        if (this.disposed || controller.signal.aborted) return
        const message =
          timeout.aborted || (error instanceof Error && error.name === 'TimeoutError')
            ? 'Gotenberg did not respond within three minutes.'
            : error instanceof Error
              ? error.message.slice(0, 500)
              : 'The conversion failed.'
        record.view = {
          id: record.view.id,
          operation: record.view.operation,
          status: 'failed',
          elapsed: performance.now() - started,
          error: message,
        }
      } finally {
        if (record.controller === controller) record.controller = undefined
        if (record.view.aborting) record.view = { ...record.view, aborting: false }
        if (!this.disposed) {
          this.emit()
          this.pump()
        }
      }
    })()
  }

  cancel(id: number) {
    const record = this.records.find(({ view }) => view.id === id)
    if (!record || (record.view.status !== 'queued' && record.view.status !== 'running')) return
    record.view = {
      id: record.view.id,
      operation: record.view.operation,
      status: 'cancelled',
      aborting: Boolean(record.controller),
    }
    record.controller?.abort()
    this.emit()
  }

  cancelAll() {
    this.pause()
    for (const record of this.records) this.cancel(record.view.id)
  }

  retry(id: number) {
    const record = this.records.find(({ view }) => view.id === id)
    if (
      !record?.input ||
      record.controller ||
      !['failed', 'cancelled'].includes(record.view.status)
    )
      return
    record.view = { id, operation: record.view.operation, status: 'queued' }
    this.emit()
    this.pump()
  }

  remove(id: number) {
    const index = this.records.findIndex(({ view }) => view.id === id)
    if (index === -1 || this.records[index]?.controller) return
    const [record] = this.records.splice(index, 1)
    if (record?.view.url) this.revokeUrl(record.view.url)
    this.emit()
  }

  clearFinished() {
    for (const record of [...this.records]) {
      if (!record.controller && record.view.status !== 'queued') this.remove(record.view.id)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const record of this.records) {
      record.controller?.abort()
      if (record.view.url) this.revokeUrl(record.view.url)
    }
    this.records = []
    this.listeners.clear()
    this.snapshot = { active: false, jobs: [] }
  }
}
