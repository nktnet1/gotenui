import type { Readable, Writable } from 'node:stream'

type CdpReply = {
  id?: number
  result?: Record<string, unknown>
  error?: { message: string }
}

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
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
            if (reply.error) waiter.reject(new Error(reply.error.message))
            else waiter.resolve(reply.result ?? {})
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
      this.pending.set(id, { resolve, reject, timeout })
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
