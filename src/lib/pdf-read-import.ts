import { METADATA_TEXT_FIELDS, validateBookmarkDocument } from '#/lib/pdf-structure-editors'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The read endpoint includes non-writable Exif/PDF information: never submit it wholesale. */
export function importReadableMetadata(result: unknown, filename: string): string {
  if (!isObject(result) || !isObject(result[filename])) {
    throw new Error(`Gotenberg did not return metadata for ${filename}.`)
  }
  const source = result[filename]
  const metadata: Record<string, string | string[]> = {}
  for (const { name } of METADATA_TEXT_FIELDS) {
    const value = source[name]
    if (typeof value === 'string' && value.trim()) metadata[name] = value
  }
  const keywords = source.Keywords
  if (Array.isArray(keywords) && keywords.every((item) => typeof item === 'string')) {
    metadata.Keywords = keywords
  } else if (typeof keywords === 'string' && keywords.trim()) {
    metadata.Keywords = keywords
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean)
  }
  const editable = JSON.stringify(metadata)
  if (editable.length > 10_000) throw new Error('Metadata is too large to import into the editor.')
  return editable
}

/** Preserve the filename-to-bookmarks map so existing source page numbers stay local. */
export function importReadableBookmarks(result: unknown, filenames: string[]): string {
  if (!isObject(result) || !filenames.length) throw new Error('Invalid bookmark read response.')
  const mapped: Record<string, unknown> = Object.create(null)
  for (const filename of filenames) {
    const items = result[filename]
    if (!Array.isArray(items))
      throw new Error(`Gotenberg did not return bookmarks for ${filename}.`)
    mapped[filename] = items
  }
  const value =
    filenames.length === 1 ? JSON.stringify(mapped[filenames[0] as string]) : JSON.stringify(mapped)
  validateBookmarkDocument(value)
  if (value.length > 10_000) throw new Error('Bookmarks are too large to import into the editor.')
  return value
}
