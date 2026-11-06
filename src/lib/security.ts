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

/** Return a harmless Unicode filename even when Gotenberg sends a hostile disposition header. */
export function downloadFilename(header: string | null, fallback: string): string {
  let candidate = fallback
  if (header) {
    const extended = header.match(/filename\*=UTF-8''([^;]+)/i)
    const ordinary = header.match(/filename="?([^";]+)"?/i)
    try {
      candidate = extended ? decodeURIComponent(extended[1] ?? '') : (ordinary?.[1] ?? fallback)
    } catch {
      candidate = fallback
    }
  }
  return cleanDownloadName(candidate, cleanDownloadName(fallback, 'download'))
}

export function responseExtension(contentType: string | null): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type === 'application/zip') return 'zip'
  if (type === 'application/json') return 'json'
  if (type === 'text/plain') return 'txt'
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
