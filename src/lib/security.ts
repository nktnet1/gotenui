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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
