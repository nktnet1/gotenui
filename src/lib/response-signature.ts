import { ProxyInputError } from '#/lib/proxy-policy'

const PDF_SIGNATURE = new TextEncoder().encode('%PDF-')
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const RIFF_SIGNATURE = new TextEncoder().encode('RIFF')
const WEBP_SIGNATURE = new TextEncoder().encode('WEBP')
// PDF readers may locate the header within the first 1,024 bytes. Gotenberg 9
// may preserve those original bytes when merging one document or applying incremental edits.
const PDF_PREAMBLE_LIMIT = 1024

function beginsWith(value: Uint8Array, signature: Uint8Array, offset = 0): boolean {
  return signature.every((byte, index) => value[offset + index] === byte)
}

function requiredBytes(type: string): number {
  switch (type) {
    case 'application/pdf':
      // A valid PDF starts with the complete version header, not just "%PDF-".
      return 8
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
      // PDF 1.0-1.7 and PDF 2.0: RFC 8118 requires a version after %PDF-.
      return (
        beginsWith(prefix, PDF_SIGNATURE) &&
        prefix[6] === 0x2e &&
        ((prefix[5] === 0x31 && prefix[7] >= 0x30 && prefix[7] <= 0x37) ||
          (prefix[5] === 0x32 && prefix[7] === 0x30))
      )
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

/** Check only the prefix needed for an optional preview of an extracted file. */
export async function hasAttachmentPreviewSignature(blob: Blob, type: string): Promise<boolean> {
  const size = requiredBytes(type)
  if (size === 0) return false
  const pdf = type === 'application/pdf'
  const prefix = new Uint8Array(
    await blob.slice(0, pdf ? PDF_PREAMBLE_LIMIT + size - 1 : size).arrayBuffer(),
  )
  if (prefix.length < size) return false
  if (!pdf) return matchesSignature(type, prefix)
  const opening = new TextDecoder().decode(prefix.subarray(0, 80))
  if (/^\s*<(?:html[\s>]|!doctype\s+html[\s>])/i.test(opening)) return false
  for (let offset = 0; offset < PDF_PREAMBLE_LIMIT && offset + size <= prefix.length; offset++) {
    if (matchesSignature(type, prefix.subarray(offset, offset + size))) return true
  }
  return false
}

/** Inspect only a bounded binary file signature before returning HTTP 200 to the browser.
 * Replay the consumed chunks without buffering the document; preserve backpressure,
 * streaming errors, and downstream cancellation of the original upstream reader.
 */
export async function verifyConversionSignature(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  declaredLength?: number,
  options: { allowPdfPreamble?: boolean } = {},
): Promise<ReadableStream<Uint8Array>> {
  const size = requiredBytes(contentType)
  if (declaredLength !== undefined && declaredLength < size) {
    await body.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg returned an inconsistent response length.', 502)
  }
  if (size === 0) return body

  const allowPdfPreamble = contentType === 'application/pdf' && options.allowPdfPreamble === true
  // The header may start at any offset before byte 1,024. Reserve seven
  // additional bytes so a header that straddles that boundary is complete.
  const maxPrefix = allowPdfPreamble ? PDF_PREAMBLE_LIMIT + size - 1 : size
  const reader = body.getReader()
  const buffered: Uint8Array[] = []
  const prefix = new Uint8Array(maxPrefix)
  let offset = 0
  let bufferedBytes = 0
  let validPreamblePdf = false
  try {
    while (offset < maxPrefix && !validPreamblePdf) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength === 0) continue
      buffered.push(value)
      bufferedBytes += value.byteLength
      if (declaredLength !== undefined && bufferedBytes > declaredLength) {
        throw new ProxyInputError('Gotenberg returned an inconsistent response length.', 502)
      }
      const previousOffset = offset
      const portion = Math.min(maxPrefix - offset, value.byteLength)
      prefix.set(value.subarray(0, portion), offset)
      offset += portion
      if (allowPdfPreamble) {
        // A gateway HTML fallback must not pass merely because its error text
        // includes a PDF version string.
        const opening = new TextDecoder().decode(prefix.subarray(0, Math.min(offset, 80)))
        if (/^\s*<(?:html[\s>]|!doctype\s+html[\s>])/i.test(opening)) {
          throw new ProxyInputError(
            'Gotenberg returned content that does not match its declared file type.',
            502,
          )
        }
        // Revisit seven previous bytes in case the header crosses a chunk.
        for (let start = Math.max(0, previousOffset - 7); start + size <= offset; start++) {
          if (start >= PDF_PREAMBLE_LIMIT) break
          if (matchesSignature('application/pdf', prefix.subarray(start, start + size))) {
            validPreamblePdf = true
            break
          }
        }
      } else if (
        // An HTML fallback on a rewritten PDF can be rejected immediately.
        contentType === 'application/pdf' &&
        offset >= 5 &&
        !beginsWith(prefix, PDF_SIGNATURE)
      ) {
        throw new ProxyInputError(
          'Gotenberg returned content that does not match its declared file type.',
          502,
        )
      }
    }
    if (
      allowPdfPreamble ? !validPreamblePdf : offset < size || !matchesSignature(contentType, prefix)
    ) {
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
