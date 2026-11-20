/** Gotenberg emits RFC 5987 UTF-8 filenames. Keep Unicode without allowing paths,
 * unsafe control characters, platform device names or injected header syntax.
 */
function cleanDownloadName(candidate: string, fallback: string): string {
  const basename = candidate.split(/[\\/]/).pop() ?? fallback
  const normalized = basename.normalize('NFC')
  const clean = normalized
    .replace(/[\\/:*?"<>|\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
  const extension = /\.[\p{L}\p{N}]{1,16}$/u.exec(clean)?.[0] ?? ''
  const root = extension ? clean.slice(0, -extension.length) : clean
  const safe = [...root].slice(0, 140 - [...extension].length).join('') + extension
  const name = safe || fallback
  const stem = name.split('.')[0] ?? name
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `file-${name}` : name
}

/** Read only actual Content-Disposition parameters, not lookalikes inside quoted values. */
function dispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined
  let index = header.indexOf(';')
  if (index === -1) return undefined

  let filename: string | undefined
  let extendedFilename: string | undefined
  while (index < header.length) {
    // Move past the preceding separator and any optional whitespace.
    while (header.charAt(index) === ';' || /[ \t]/.test(header.charAt(index))) index++
    const nameStart = index
    while (index < header.length && !/[=;]/.test(header.charAt(index))) index++
    if (header.charAt(index) !== '=') continue
    const name = header.slice(nameStart, index).trim().toLowerCase()
    index++
    while (/[ \t]/.test(header.charAt(index)) && index < header.length) index++

    let value = ''
    if (header.charAt(index) === '"') {
      index++
      let closed = false
      while (index < header.length) {
        const char = header.charAt(index++)
        if (char === '\\' && index < header.length) {
          value += header.charAt(index++)
        } else if (char === '"') {
          closed = true
          break
        } else {
          value += char
        }
      }
      if (!closed) break
      while (index < header.length && /[ \t]/.test(header.charAt(index))) index++
      if (index < header.length && header.charAt(index) !== ';') {
        const next = header.indexOf(';', index)
        index = next === -1 ? header.length : next
        continue
      }
    } else {
      const next = header.indexOf(';', index)
      value = header.slice(index, next === -1 ? header.length : next).trim()
      index = next === -1 ? header.length : next
    }

    if (value && name === 'filename' && filename === undefined) filename = value
    if (value && name === 'filename*' && extendedFilename === undefined) extendedFilename = value
  }

  const encoded = extendedFilename?.match(/^UTF-8'[^']*'(.*)$/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // An invalid extended parameter must not override a valid ASCII filename.
    }
  }
  return filename
}

/** Require a real filename parameter for arbitrary extracted attachment responses. */
export function hasAttachmentFilename(header: string | null): boolean {
  return dispositionFilename(header) !== undefined
}

/** Return a harmless Unicode filename even when Gotenberg sends a hostile disposition header. */
export function downloadFilename(header: string | null, fallback: string): string {
  return cleanDownloadName(
    dispositionFilename(header) ?? fallback,
    cleanDownloadName(fallback, 'download'),
  )
}

export function responseExtension(contentType: string | null): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type === 'application/zip') return 'zip'
  if (type === 'application/json') return 'json'
  if (type === 'text/plain') return 'txt'
  if (type === 'text/markdown') return 'md'
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpeg'
  if (type === 'image/webp') return 'webp'
  return 'bin'
}

/** Supply an ASCII fallback and RFC 5987 filename* for Unicode-aware browsers. */
function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const fallback = `attachment; filename="${ascii}"`
  if (ascii === name) return fallback
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${fallback}; filename*=UTF-8''${encoded}`
}

/** Force an attachment download and derive the extension from its verified type.
 * Extracted embedded files are the exception: their actual extension is not
 * predictable from their arbitrary MIME type, so retain Gotenberg's filename.
 */
export function safeAttachmentDisposition(
  upstreamDisposition: string | null,
  fallbackBase: string,
  contentType: string,
  requestedBase?: string,
  preserveOriginalName = false,
): string {
  const extension = responseExtension(contentType)
  const fallback = `${fallbackBase}.${extension}`
  const upstreamName = downloadFilename(upstreamDisposition, fallback)
  if (preserveOriginalName) return attachmentHeader(upstreamName)
  const candidate = requestedBase ? `${requestedBase}.${extension}` : upstreamName
  const knownExtension =
    candidate.toLowerCase().endsWith(`.${extension}`) ||
    (extension === 'jpeg' && candidate.toLowerCase().endsWith('.jpg'))
  const root = knownExtension
    ? candidate.slice(0, candidate.lastIndexOf('.'))
    : candidate.replace(/\.[^.]*$/, '')
  const safeRoot = cleanDownloadName(root, 'download')
  const finalExtension =
    knownExtension && extension === 'jpeg' && /\.jpg$/i.test(candidate) ? 'jpg' : extension
  return attachmentHeader(cleanDownloadName(`${safeRoot}.${finalExtension}`, fallback))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
