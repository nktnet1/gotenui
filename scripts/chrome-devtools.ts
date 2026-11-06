import type { Readable, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'

type CdpReply = {
  id?: number
  result?: Record<string, unknown>
  error?: { code?: number; message: string }
}

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  method: string
  callSite: Error
}

/** Chrome's --remote-debugging-pipe uses NUL-delimited CDP messages over fds 3 and 4. */
export class ChromeDevToolsPipe {
  private id = 0
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, PendingCommand>()
  private failure?: Error
  private readonly input: Writable
  private readonly output: Readable

  constructor(input: Writable, output: Readable) {
    this.input = input
    this.output = output
    output.on('data', (data: Buffer) => this.receive(data))
    output.on('end', () => this.fail(new Error('Chrome DevTools pipe closed.')))
    output.on('error', (error: Error) => this.fail(error))
    input.on('error', (error: Error) => this.fail(error))
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    let delimiter = this.buffer.indexOf(0)
    while (delimiter !== -1) {
      const frame = this.buffer.subarray(0, delimiter)
      this.buffer = this.buffer.subarray(delimiter + 1)
      if (frame.length) {
        let reply: CdpReply
        try {
          reply = JSON.parse(frame.toString('utf8')) as CdpReply
        } catch (error) {
          this.fail(new Error('Chrome DevTools returned invalid JSON.', { cause: error }))
          return
        }
        if (reply.id !== undefined) {
          const waiter = this.pending.get(reply.id)
          if (waiter) {
            this.pending.delete(reply.id)
            clearTimeout(waiter.timeout)
            if (reply.error) {
              const code = reply.error.code === undefined ? '' : ` (${reply.error.code})`
              waiter.callSite.message = `Chrome DevTools ${waiter.method} failed${code}: ${reply.error.message}`
              waiter.reject(waiter.callSite)
            } else waiter.resolve(reply.result ?? {})
          }
        }
      }
      delimiter = this.buffer.indexOf(0)
    }
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout)
      waiter.reject(error)
    }
    this.pending.clear()
  }

  command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 8_000,
  ): Promise<Record<string, unknown>> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.id
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome DevTools command timed out: ${method}`))
      }, timeoutMs)
      // Preserve the caller's stack instead of attributing every CDP error to receive().
      this.pending.set(id, {
        resolve,
        reject,
        timeout,
        method,
        callSite: new Error(`Chrome DevTools ${method} failed`),
      })
      try {
        this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`, (error) => {
          if (error) this.fail(error)
        })
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('Cannot write to Chrome DevTools.'))
      }
    })
  }

  close(): void {
    this.fail(new Error('Chrome DevTools pipe closed.'))
    this.input.end()
    this.output.destroy()
  }
}

/** Attach to Chrome's initial page instead of starting another renderer during startup. */
export async function attachToChromePage(
  devtools: ChromeDevToolsPipe,
  timeoutMs = 12_000,
): Promise<string> {
  // A successful browser-level command confirms that the debugging pipe is ready.
  await devtools.command('Browser.getVersion', {}, undefined, timeoutMs)
  const { targetInfos } = await devtools.command('Target.getTargets', {}, undefined, timeoutMs)
  const pages = Array.isArray(targetInfos) ? targetInfos : []
  const existing = pages.find(
    (target): target is { type: string; attached: boolean; targetId: string } =>
      typeof target === 'object' &&
      target !== null &&
      target.type === 'page' &&
      target.attached !== true &&
      typeof target.targetId === 'string',
  )
  let targetId = existing?.targetId
  if (!targetId) {
    const created = await devtools.command(
      'Target.createTarget',
      { url: 'about:blank' },
      undefined,
      timeoutMs,
    )
    if (typeof created.targetId !== 'string') {
      throw new Error('Chrome did not create a debugging page target.')
    }
    targetId = created.targetId
  }
  const attached = await devtools.command(
    'Target.attachToTarget',
    { targetId, flatten: true },
    undefined,
    timeoutMs,
  )
  if (typeof attached.sessionId !== 'string') {
    throw new Error('Chrome did not attach to the page target.')
  }
  return attached.sessionId
}

/**
 * Document navigation can invalidate a Runtime.evaluate call while Chrome is
 * responding. Only read-only polling can safely retry these transient errors.
 * Never retry an action that may already have been performed on the page.
 */
export function isNavigationContextLost(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/i.test(
    error.message,
  )
}

/** Poll only read-only predicates across transient cross-document navigations. */
export async function waitForBrowserCondition(
  evaluate: () => Promise<unknown>,
  description: string,
  timeoutMs = 10_000,
  intervalMs = 75,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let navigationError: Error | undefined
  while (Date.now() < deadline) {
    try {
      if (await evaluate()) return
    } catch (error) {
      if (!isNavigationContextLost(error)) {
        throw new Error(`Browser check failed: ${description}`, { cause: error })
      }
      navigationError = error as Error
    }
    await sleep(intervalMs)
  }
  throw new Error(`Browser check timed out: ${description}`, { cause: navigationError })
}

/** Navigate through browser history without evaluating history.back()/forward().
 * Evaluating those expressions can destroy their own execution context before
 * the CDP reply arrives, especially across the smoke's full-page reload.
 */
export async function navigateChromeHistory(
  devtools: ChromeDevToolsPipe,
  sessionId: string,
  direction: -1 | 1,
): Promise<void> {
  const { currentIndex, entries } = await devtools.command(
    'Page.getNavigationHistory',
    {},
    sessionId,
  )
  const targetIndex = typeof currentIndex === 'number' ? currentIndex + direction : NaN
  const history = Array.isArray(entries) ? entries : []
  const entry = history[targetIndex] as { id?: unknown } | undefined
  if (!entry || !Number.isSafeInteger(entry.id)) {
    throw new Error(
      `No Chrome history entry available to navigate ${direction < 0 ? 'back' : 'forward'}.`,
    )
  }
  await devtools.command('Page.navigateToHistoryEntry', { entryId: entry.id }, sessionId)
}
