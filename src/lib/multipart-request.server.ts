import { isUtf8 } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { ProxyInputError } from '#/lib/proxy-policy'

/** Node's disposition decoder assumes an empty language tag and strips a
 * leading BOM from ordinary quoted values. Reframe affected parameters without
 * touching unrelated quoted attributes or the original part contents.
 */
function normalizeMultipartHeaders(headers: Buffer): string | undefined {
  const text = headers.toString('utf8')
  const singletonHeaders = new Set<string>()
  const normalized = text
    .split('\r\n')
    .map((line) => {
      const header = /^[ \t]*(content-disposition|content-type)[ \t]*:/i
        .exec(line)?.[1]
        .toLowerCase()
      if (header) {
        if (singletonHeaders.has(header))
          throw new ProxyInputError(`Multipart parts must not repeat ${header}.`)
        singletonHeaders.add(header)
      }
      // MIME transfer encoding names are case-insensitive, but Node compares
      // the base64 name literally when deciding whether to decode the part.
      if (/^[ \t]*content-transfer-encoding[ \t]*:[ \t]*base64[ \t]*$/i.test(line))
        return 'Content-Transfer-Encoding: base64'
      if (!/^[ \t]*content-disposition[ \t]*:/i.test(line)) return line
      // MIME allows whitespace around parameter separators. Node stops
      // parsing at whitespace before a semicolon, or includes a trailing
      // tab in an extended value. Never remove spaces inside quoted values.
      // Native FormData does not understand MIME quoted-pairs. Translate
      // escaped MIME specials while retaining literal backslashes before
      // ordinary characters (including Windows path separators). The
      // native decoder recognizes %22 as a quoted double quote.
      const disposition = line
        .replace(/"(?:\\[^\r\n]|[^"\\\r\n])*"/g, (quoted) =>
          quoted.replace(/\\(.)/gu, (pair, char: string) =>
            char === '"' ? '%22' : '()<>@,;:\\"/[]?='.includes(char) ? char : pair,
          ),
        )
        .replace(/"[^"\r\n]*"|[ \t]+(?=[;=]|$)/g, (match) => (match.startsWith('"') ? match : ''))
      const attributes =
        /(;[ \t]*(name|filename)(\*)?=[ \t]*)(?:"([^"\r\n]*)"|([^ \t;]*))|"[^"\r\n]*"/gi
      // Native parsing gives extended filenames precedence over ordinary
      // ones. Use an extended value for a leading BOM only when that
      // ordinary filename is the effective filename.
      const parameters = [...disposition.matchAll(attributes)].filter((match) => match[1])
      const seenParameters = new Set<string>()
      for (const parameter of parameters) {
        const name = parameter[2].toLowerCase()
        // The native parser supports an ordinary filename fallback alongside
        // filename*, but name and name* compete for the actual form field.
        const key = name === 'filename' && parameter[3] ? 'filename*' : name
        if (seenParameters.has(key))
          throw new ProxyInputError(`Multipart disposition must not repeat ${key}.`)
        seenParameters.add(key)
      }
      const filenames = parameters.filter((match) => match[2].toLowerCase() === 'filename')
      const effectiveFilename = filenames.filter((match) => match[3]).at(-1) ?? filenames.at(-1)
      return disposition.replace(
        attributes,
        (match, prefix, name, extendedMarker, quoted, raw, offset) => {
          if (prefix === undefined) return match
          if (!extendedMarker) {
            if (
              !quoted?.startsWith('\uFEFF') ||
              (name.toLowerCase() === 'filename' && offset !== effectiveFilename?.index)
            )
              return match
            // Preserve Node's ordinary quoted-parameter escape semantics
            // without relying on its TextDecoder to strip an extra BOM.
            const decoded = quoted
              .replace(/%0A/gi, '\n')
              .replace(/%0D/gi, '\r')
              .replace(/%22/g, '"')
            const encoded = encodeURIComponent(decoded).replace(
              /[!'()*]/g,
              (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
            )
            return `${prefix.replace('=', '*=')}UTF-8''${encoded}`
          }
          const extended = /^UTF-8'([a-z0-9-]*)'([a-z0-9!#$&+.^_`|~%-]*)$/i.exec(raw ?? '')
          if (!extended)
            throw new ProxyInputError('Invalid extended multipart disposition parameter.')
          try {
            decodeURIComponent(extended[2])
          } catch {
            throw new ProxyInputError('Invalid extended multipart disposition parameter.')
          }
          return `${prefix}UTF-8''${extended[2]}`
        },
      )
    })
    .join('\r\n')
  return text === normalized ? undefined : normalized
}

/** Native multipart decoding is permissive about malformed Base64 and ignores
 * unknown transfer encodings. Reject those instead of forwarding altered bytes.
 */
function transferEncoding(headers: Buffer): 'base64' | undefined {
  const encodings = headers
    .toString('utf8')
    .split('\r\n')
    .flatMap((line) => {
      const match = /^[ \t]*content-transfer-encoding[ \t]*:[ \t]*([^\r\n]*)$/i.exec(line)
      return match ? [match[1].replace(/[ \t]+$/, '').toLowerCase()] : []
    })
  if (encodings.length > 1)
    throw new ProxyInputError('Multipart parts must not repeat Content-Transfer-Encoding.')
  const encoding = encodings[0]
  if (encoding === 'base64') return encoding
  if (encoding !== undefined && !['binary', '8bit', '7bit'].includes(encoding)) {
    throw new ProxyInputError('Unsupported multipart Content-Transfer-Encoding.')
  }
  return undefined
}

function validateBase64(body: Buffer): void {
  // MIME permits wrapped Base64. Only ASCII whitespace is ignored, not
  // arbitrary punctuation, non-ASCII bytes, or a second padded quantum.
  const encoded = body.toString('latin1').replace(/[ \t\r\n]/g, '')
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new ProxyInputError('Multipart Base64 transfer encoding is invalid.')
  }
}

/** Native FormData decoding replaces malformed UTF-8 in text fields and
 * ordinary filename parameters. Retain the original wire offsets to check
 * those bytes without interpreting arbitrary binary uploads as text.
 */
export async function parseMultipartRequest(
  input: Uint8Array<ArrayBuffer>,
  boundary: string,
): Promise<FormData> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const marker = Buffer.from(`--${boundary}`)
  const separator = Buffer.from(`\r\n--${boundary}`)
  const crlf = Buffer.from('\r\n')
  const closing = Buffer.from('--')
  const startsWith = (offset: number, value: Buffer) =>
    bytes.subarray(offset, offset + value.length).equals(value)
  const delimiterAt = (at: number) => {
    const after = at + marker.length
    const closed = startsWith(after, closing)
    const paddingStart = after + (closed ? closing.length : 0)
    let end = paddingStart
    // RFC 2046 requires receivers to ignore transport padding on delimiter lines.
    while (bytes[end] === 32 || bytes[end] === 9) end++
    if (!startsWith(end, crlf) && !(closed && end === bytes.length)) return undefined
    return {
      at,
      next: end + (end === bytes.length ? 0 : crlf.length),
      closed,
      padded: end !== paddingStart,
    }
  }
  const findBoundary = (from: number) => {
    for (
      let at = bytes.indexOf(separator, from);
      at !== -1;
      at = bytes.indexOf(separator, at + separator.length)
    ) {
      const delimiter = delimiterAt(at + 2)
      if (delimiter) return delimiter
    }
    throw new ProxyInputError('Invalid multipart form data.')
  }

  let delimiter = (startsWith(0, marker) && delimiterAt(0)) || findBoundary(0)
  const parts: {
    headers: Buffer<ArrayBuffer>
    body: Buffer<ArrayBuffer>
    normalized?: string
    encoding?: 'base64'
  }[] = []
  let reframe = bytes.indexOf(marker) !== delimiter.at || delimiter.padded
  while (!delimiter.closed) {
    const headerStart = delimiter.next
    const headerEnd = bytes.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) throw new ProxyInputError('Invalid multipart form data.')
    const headers = bytes.subarray(headerStart, headerEnd)
    if (!isUtf8(headers)) throw new ProxyInputError('Multipart headers must be valid UTF-8.')
    const normalized = normalizeMultipartHeaders(headers)
    const bodyStart = headerEnd + 4
    delimiter = findBoundary(bodyStart)
    const body = bytes.subarray(bodyStart, delimiter.at - 2)
    const encoding = transferEncoding(headers)
    if (encoding === 'base64') validateBase64(body)
    parts.push({ headers, body, normalized, encoding })
    // Some Node versions search for the bare boundary token anywhere inside
    // the part, rather than the CRLF-prefixed delimiter line. Reframe only
    // requests that the native parser cannot decode faithfully.
    reframe ||=
      normalized !== undefined ||
      delimiter.padded ||
      bytes.indexOf(boundary, bodyStart) !== delimiter.at + 2
  }

  let data: Uint8Array<ArrayBuffer> | Blob = input
  // The proxy has already validated the media type and boundary. Native MIME
  // parsing rejects some legal parameter whitespace, so use the validated
  // boundary directly rather than parsing the original Content-Type again.
  let contentType = `multipart/form-data; boundary="${boundary}"`
  if (reframe) {
    let replacement: string
    do {
      replacement = `gotenui-${randomBytes(24).toString('hex')}`
    } while (bytes.includes(replacement))
    const segments: BlobPart[] = []
    // Preamble and epilogue are ignored by MIME readers. Copy just the actual
    // parts to a new envelope, preserving every byte of each file or value.
    for (const part of parts) {
      segments.push(
        `--${replacement}\r\n`,
        part.normalized ?? part.headers,
        '\r\n\r\n',
        part.body,
        '\r\n',
      )
    }
    segments.push(`--${replacement}--\r\n`)
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
    if (part.encoding === 'base64') body = Buffer.from(body.toString('ascii'), 'base64')
    if (!isUtf8(body)) throw new ProxyInputError('Multipart text must be valid UTF-8.')
  }
  if (index !== parts.length) throw new ProxyInputError('Invalid multipart form data.')
  return fields
}
