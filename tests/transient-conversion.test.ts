import { describe, expect, it, vi } from 'vitest'
import { retryTransientConversion } from './integration/transient-conversion'

describe('transient PDF/A integration failures', () => {
  it('retries a temporary HTTP 500 using a new request, then validates the successful response', async () => {
    const convert = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Temporary conversion failure', {
          status: 500,
          headers: { 'gotenberg-trace': 'attempt-one' },
        }),
      )
      .mockResolvedValueOnce(new Response('PK test ZIP', { status: 200 }))
    const onRetry = vi.fn()
    const pause = vi.fn().mockResolvedValue(undefined)

    const response = await retryTransientConversion(convert, { pause, onRetry })
    expect(await response.text()).toBe('PK test ZIP')
    expect(convert).toHaveBeenCalledTimes(2)
    expect(pause).toHaveBeenCalledWith(1)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      status: 500,
      trace: 'attempt-one',
      body: 'Temporary conversion failure',
    })
  })

  it('does not retry validation or authentication failures', async () => {
    const convert = vi.fn().mockResolvedValue(new Response('Bad input', { status: 400 }))
    const response = await retryTransientConversion(convert)
    expect(response.status).toBe(400)
    expect(convert).toHaveBeenCalledOnce()
  })

  it('does not hide persistent server failures after the retry limit', async () => {
    const convert = vi
      .fn()
      .mockImplementation(async () => new Response('Still failing', { status: 503 }))
    const pause = vi.fn().mockResolvedValue(undefined)
    const response = await retryTransientConversion(convert, { pause })
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Still failing')
    expect(convert).toHaveBeenCalledTimes(3)
    expect(pause).toHaveBeenCalledTimes(2)
  })
})
