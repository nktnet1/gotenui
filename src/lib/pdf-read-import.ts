import {
  GOTENBERG_9_METADATA_FIELDS,
  METADATA_TEXT_FIELDS,
  validateBookmarkDocument,
} from '#/lib/pdf-structure-editors'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The read endpoint includes non-writable Exif/PDF information: never submit it wholesale. */
export function importReadableMetadata(
  result: unknown,
  filename: string,
  { standardOnly = false }: { standardOnly?: boolean } = {},
): string {
  // Read-route result keys use the NFC filename registered by Gotenberg.
  const source = isObject(result) ? (result[filename] ?? result[filename.normalize('NFC')]) : null
  if (!isObject(source)) {
    throw new Error(`Gotenberg did not return metadata for ${filename}.`)
  }
  const metadata: Record<string, string | string[]> = {}
  const editableFields = standardOnly ? GOTENBERG_9_METADATA_FIELDS : METADATA_TEXT_FIELDS
  for (const { name } of editableFields) {
    const value = source[name] ?? source[name.charAt(0).toLowerCase() + name.slice(1)]
    if (typeof value === 'string' && value.trim()) metadata[name] = value
  }
  const keywords = source.Keywords ?? source.keywords
  if (Array.isArray(keywords) && keywords.every((item) => typeof item === 'string')) {
    metadata.Keywords = keywords
  } else if (typeof keywords === 'string' && keywords.trim()) {
    metadata.Keywords = keywords
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean)
  }
  const editable = JSON.stringify(metadata)
  return editable
}

/** Preserve the filename-to-bookmarks map so existing source page numbers stay local. */
export function importReadableBookmarks(result: unknown, filenames: string[]): string {
  if (!isObject(result) || !filenames.length) throw new Error('Invalid bookmark read response.')
  const mapped: Record<string, unknown> = Object.create(null)
  for (const filename of filenames) {
    const items = result[filename] ?? result[filename.normalize('NFC')]
    if (!Array.isArray(items))
      throw new Error(`Gotenberg did not return bookmarks for ${filename}.`)
    mapped[filename] = items.map(normalizeReadBookmark)
  }
  const value =
    filenames.length === 1 ? JSON.stringify(mapped[filenames[0] as string]) : JSON.stringify(mapped)
  validateBookmarkDocument(value)
  return value
}

/** Convert the v9 pageNumber JSON back to the existing v8-compatible editor shape. */
function normalizeReadBookmark(value: unknown): unknown {
  if (!isObject(value)) return value
  const { pageNumber, children, ...rest } = value
  if (pageNumber === undefined)
    return {
      ...rest,
      ...(children !== undefined
        ? { children: Array.isArray(children) ? children.map(normalizeReadBookmark) : children }
        : {}),
    }
  return {
    ...rest,
    page: pageNumber,
    ...(children !== undefined
      ? { children: Array.isArray(children) ? children.map(normalizeReadBookmark) : children }
      : {}),
  }
}
