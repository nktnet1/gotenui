/** Ensure asynchronous connection checks can only publish the latest draft's result. */
export class LatestProbe {
  private active: AbortController | null = null

  get pending(): boolean {
    return this.active !== null
  }

  cancel(): void {
    const controller = this.active
    this.active = null
    controller?.abort()
  }

  async run<T>(
    check: (signal: AbortSignal) => Promise<T>,
    callbacks: {
      success: (result: T) => void
      error: (error: unknown) => void
      settled: () => void
    },
    timeoutMs = 8_000,
  ): Promise<void> {
    this.cancel()
    const controller = new AbortController()
    this.active = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
    let onAbort: (() => void) | undefined
    try {
      const value = await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        // A transport that ignores its signal must still settle the probe at
        // the deadline and cannot publish a successful result afterwards.
        check(signal).then(resolve, reject)
      })
      signal.throwIfAborted()
      if (this.active === controller) callbacks.success(value)
    } catch (error) {
      if (this.active === controller && !controller.signal.aborted) callbacks.error(error)
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort)
      if (this.active === controller) {
        this.active = null
        callbacks.settled()
      }
    }
  }
}
