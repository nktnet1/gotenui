import { ProxyInputError } from '#/lib/proxy-policy'

const PDF_SIGNATURE = new TextEncoder().encode('%PDF-')
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const RIFF_SIGNATURE = new TextEncoder().encode('RIFF')
const WEBP_SIGNATURE = new TextEncoder().encode('WEBP')

function beginsWith(value: Uint8Array, signature: Uint8Array, offset = 0): boolean {
  return signature.every((byte, index) => value[offset + index] === byte)
}

function requiredBytes(type: string): number {
  switch (type) {
    case 'application/pdf':
      return 5
    case 'application/zip':
      return 4
    case 'image/png':
      return 8
    case 'image/jpeg':
      return 3
    case 'image/webp':
      return 12
    default:
      // Gotenberg metadata JSON is not a binary file; do not require a signature.
      return 0
  }
}

function matchesSignature(type: string, prefix: Uint8Array): boolean {
  switch (type) {
    case 'application/pdf':
      return beginsWith(prefix, PDF_SIGNATURE)
    case 'application/zip':
      return (
        prefix[0] === 0x50 &&
        prefix[1] === 0x4b &&
        ((prefix[2] === 0x03 && prefix[3] === 0x04) ||
          (prefix[2] === 0x05 && prefix[3] === 0x06) ||
          (prefix[2] === 0x07 && prefix[3] === 0x08))
      )
    case 'image/png':
      return beginsWith(prefix, PNG_SIGNATURE)
    case 'image/jpeg':
      return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    case 'image/webp':
      return beginsWith(prefix, RIFF_SIGNATURE) && beginsWith(prefix, WEBP_SIGNATURE, 8)
    default:
      return true
  }
}

/** Inspect only the binary file signature before returning HTTP 200 to the browser.
 * Replay the consumed chunks without buffering the document; preserve backpressure,
 * streaming errors, and downstream cancellation of the original upstream reader.
 */
export async function verifyConversionSignature(
  body: ReadableStream<Uint8Array>,
  contentType: string,
): Promise<ReadableStream<Uint8Array>> {
  const size = requiredBytes(contentType)
  if (size === 0) return body

  const reader = body.getReader()
  const buffered: Uint8Array[] = []
  const prefix = new Uint8Array(size)
  let offset = 0
  try {
    while (offset < size) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength === 0) continue
      buffered.push(value)
      const portion = Math.min(size - offset, value.byteLength)
      prefix.set(value.subarray(0, portion), offset)
      offset += portion
    }
    if (offset < size || !matchesSignature(contentType, prefix)) {
      throw new ProxyInputError(
        'Gotenberg returned content that does not match its declared file type.',
        502,
      )
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    throw error
  }

  let released = false
  let cancelled = false
  const release = () => {
    if (!released) {
      released = true
      reader.releaseLock()
    }
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (cancelled) return
        if (done) {
          release()
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    async cancel(reason) {
      cancelled = true
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    },
  })
}
