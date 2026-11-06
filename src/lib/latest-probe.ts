/** Ensure asynchronous connection checks can only publish the latest draft's result. */
export class LatestProbe {
  private active: AbortController | null = null

  cancel(): void {
    this.active?.abort()
    this.active = null
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
    try {
      const value = await check(
        AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
      )
      if (this.active === controller && !controller.signal.aborted) callbacks.success(value)
    } catch (error) {
      if (this.active === controller && !controller.signal.aborted) callbacks.error(error)
    } finally {
      if (this.active === controller) {
        this.active = null
        callbacks.settled()
      }
    }
  }
}
