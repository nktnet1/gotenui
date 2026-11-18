import { describe, expect, it, vi } from 'vitest'
import { retryTransientConversion, smokeConversion } from './integration/transient-conversion'

describe('transient Gotenberg integration failures', () => {
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

  it('reissues a fresh request after a transient LibreOffice error', async () => {
    const requests: Request[] = []
    const convert = vi.fn(async () => {
      const request = new Request('http://localhost/forms/libreoffice/convert', {
        method: 'POST',
        body: new FormData(),
      })
      requests.push(request)
      return new Response(requests.length === 1 ? 'Busy' : '%PDF-', {
        status: requests.length === 1 ? 500 : 200,
      })
    })
    const pause = vi.fn().mockResolvedValue(undefined)

    const response = await retryTransientConversion(convert, { pause })
    expect(await response.text()).toBe('%PDF-')
    expect(convert).toHaveBeenCalledTimes(2)
    expect(requests).toHaveLength(2)
    expect(requests[0]).not.toBe(requests[1])
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

  it('retries only the LibreOffice route in the integration smoke matrix', async () => {
    const pause = vi.fn().mockResolvedValue(undefined)
    const officeConvert = vi
      .fn()
      .mockResolvedValueOnce(new Response('LibreOffice temporarily unavailable', { status: 500 }))
      .mockResolvedValueOnce(new Response('%PDF-', { status: 200 }))
    const office = await smokeConversion('/forms/libreoffice/convert', officeConvert, { pause })
    expect(await office.text()).toBe('%PDF-')
    expect(officeConvert).toHaveBeenCalledTimes(2)
    expect(pause).toHaveBeenCalledOnce()

    const pdfConvert = vi
      .fn()
      .mockResolvedValue(new Response('PDF processing failed', { status: 500 }))
    const pdf = await smokeConversion('/forms/pdfengines/convert', pdfConvert, { pause })
    expect(pdf.status).toBe(500)
    expect(pdfConvert).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
  })

  it('does not retry a LibreOffice smoke request rejected with HTTP 4xx', async () => {
    const convert = vi.fn().mockResolvedValue(new Response('Invalid form', { status: 422 }))
    const pause = vi.fn().mockResolvedValue(undefined)
    const response = await smokeConversion('/forms/libreoffice/convert', convert, { pause })
    expect(response.status).toBe(422)
    expect(convert).toHaveBeenCalledOnce()
    expect(pause).not.toHaveBeenCalled()
  })

  it('still fails after persistent LibreOffice server errors', async () => {
    const convert = vi.fn().mockResolvedValue(new Response('Persistent error', { status: 500 }))
    const pause = vi.fn().mockResolvedValue(undefined)
    const response = await smokeConversion('/forms/libreoffice/convert', convert, { pause })
    expect(response.status).toBe(500)
    expect(convert).toHaveBeenCalledTimes(3)
    expect(pause).toHaveBeenCalledTimes(2)
  })
})
