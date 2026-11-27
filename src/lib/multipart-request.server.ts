import { isUtf8 } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { ProxyInputError } from '#/lib/proxy-policy'

/** Native FormData decoding replaces malformed UTF-8 in text fields and
 * ordinary filename parameters. Retain the original wire offsets to check
 * those bytes without interpreting arbitrary binary uploads as text.
 */
export async function parseMultipartRequest(
  input: Uint8Array<ArrayBuffer>,
  boundary: string,
  contentType: string,
): Promise<FormData> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const marker = Buffer.from(`--${boundary}`)
  const separator = Buffer.from(`\r\n--${boundary}`)
  const crlf = Buffer.from('\r\n')
  const closing = Buffer.from('--')
  const startsWith = (offset: number, value: Buffer) =>
    bytes.subarray(offset, offset + value.length).equals(value)
  const validSuffix = (at: number) => {
    const after = at + marker.length
    if (startsWith(after, crlf)) return true
    if (!startsWith(after, closing)) return false
    let end = after + closing.length
    while (bytes[end] === 32 || bytes[end] === 9) end++
    return end === bytes.length || startsWith(end, crlf)
  }
  const findBoundary = (from: number): number => {
    for (
      let at = bytes.indexOf(separator, from);
      at !== -1;
      at = bytes.indexOf(separator, at + separator.length)
    ) {
      if (validSuffix(at + 2)) return at + 2
    }
    throw new ProxyInputError('Invalid multipart form data.')
  }

  let at = startsWith(0, marker) && validSuffix(0) ? 0 : findBoundary(0)
  const offsets = [at]
  const parts: { headers: Buffer; body: Buffer }[] = []
  let ambiguous = bytes.indexOf(marker) !== at
  while (!startsWith(at + marker.length, closing)) {
    const headerStart = at + marker.length + 2
    const headerEnd = bytes.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) throw new ProxyInputError('Invalid multipart form data.')
    const headers = bytes.subarray(headerStart, headerEnd)
    if (!isUtf8(headers)) throw new ProxyInputError('Multipart headers must be valid UTF-8.')
    const bodyStart = headerEnd + 4
    at = findBoundary(bodyStart)
    parts.push({ headers, body: bytes.subarray(bodyStart, at - 2) })
    offsets.push(at)
    // Some Node versions search for the bare boundary token anywhere inside
    // the part, rather than the CRLF-prefixed delimiter line. Reframe only
    // those ambiguous requests using a token absent from the entire input.
    ambiguous ||= bytes.indexOf(boundary, bodyStart) !== at + 2
  }

  let data: Uint8Array<ArrayBuffer> | Blob = input
  if (ambiguous) {
    let replacement: string
    do {
      replacement = `gotenui-${randomBytes(24).toString('hex')}`
    } while (bytes.includes(replacement))
    const segments: BlobPart[] = []
    let previous = 0
    for (const offset of offsets) {
      segments.push(input.subarray(previous, offset + 2), replacement)
      previous = offset + marker.length
    }
    segments.push(input.subarray(previous))
    data = new Blob(segments)
    contentType = `multipart/form-data; boundary=${replacement}`
  }

  let fields: FormData
  try {
    fields = await new Response(data, { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    throw new ProxyInputError('Invalid multipart form data.')
  }
  let index = 0
  for (const [, value] of fields) {
    const part = parts[index++]
    if (!part) throw new ProxyInputError('Invalid multipart form data.')
    if (typeof value !== 'string') continue
    let { body } = part
    // Node also supports the deprecated MIME base64 transfer encoding.
    const encoding = [
      ...part.headers
        .toString('utf8')
        .matchAll(/^[ \t]*content-transfer-encoding[ \t]*:[ \t]*([^\r\n]*)$/gim),
    ]
      .at(-1)?.[1]
      .replace(/[ \t]+$/, '')
    if (encoding === 'base64') body = Buffer.from(body.toString(), 'base64')
    if (!isUtf8(body)) throw new ProxyInputError('Multipart text must be valid UTF-8.')
  }
  if (index !== parts.length) throw new ProxyInputError('Invalid multipart form data.')
  return fields
}
