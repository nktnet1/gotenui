/** Return a harmless filename even when Gotenberg sends a hostile disposition header. */
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
  const basename = candidate.split(/[\\/]/).pop() ?? fallback
  const safe = basename
    .replace(/[^a-zA-Z0-9 _.()-]/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 140)
  return safe || fallback
}

export function responseExtension(contentType: string | null): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type === 'application/zip') return 'zip'
  if (type === 'application/json') return 'json'
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpeg'
  if (type === 'image/webp') return 'webp'
  return 'bin'
}

/** Never allow an upstream gateway to choose how the browser handles a download.
 * Gotenberg normally returns an attachment with a matching extension, but a
 * misconfigured proxy can return `inline`, HTML filenames, or path segments.
 * Derive the extension from the already-validated response media type instead.
 */
export function safeAttachmentDisposition(
  upstreamDisposition: string | null,
  fallbackBase: string,
  contentType: string,
  requestedBase?: string,
): string {
  const extension = responseExtension(contentType)
  const fallback = `${fallbackBase}.${extension}`
  const upstreamName = downloadFilename(upstreamDisposition, fallback)
  const candidate = requestedBase ? `${requestedBase}.${extension}` : upstreamName
  const knownExtension =
    candidate.toLowerCase().endsWith(`.${extension}`) ||
    (extension === 'jpeg' && candidate.toLowerCase().endsWith('.jpg'))
  const root = knownExtension
    ? candidate.slice(0, candidate.lastIndexOf('.'))
    : candidate.replace(/\.[^.]*$/, '')
  const safeRoot = root
    .replace(/[^a-zA-Z0-9 _.()-]/g, '_')
    .replace(/^[._ ]+|[._ ]+$/g, '')
    .slice(0, 140 - extension.length - 1)
    .replace(/[._ ]+$/g, '')
  // Windows reserves these basenames even when an extension is appended.
  const basename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeRoot)
    ? `file-${safeRoot}`
    : safeRoot || 'download'
  const finalExtension =
    knownExtension && extension === 'jpeg' && /\.jpg$/i.test(candidate) ? 'jpg' : extension
  return `attachment; filename="${basename}.${finalExtension}"`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
