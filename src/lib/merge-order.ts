/** Prefix local merge inputs so Gotenberg's filename sort follows the visible order. */
export function mergeUploadFilename(filename: string, index: number, count: number): string {
  const prefix = String(index + 1).padStart(Math.max(2, String(count).length), '0')
  return `${prefix}_${filename}`
}

/** Keep filename-keyed bookmarks attached to their PDF after merge upload renaming. */
export function mergeBookmarks(value: string, filenames: string[]): string {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value

  const input = parsed as Record<string, unknown>
  const mapped: Record<string, unknown> = Object.create(null)
  for (const [key, bookmarks] of Object.entries(input)) {
    if (!filenames.some((filename) => filename === key)) mapped[key] = bookmarks
  }
  for (const [index, filename] of filenames.entries()) {
    if (Object.hasOwn(input, filename)) {
      mapped[mergeUploadFilename(filename, index, filenames.length)] = input[filename]
    }
  }
  return JSON.stringify(mapped)
}
