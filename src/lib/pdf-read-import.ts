import { filenameKey } from '#/lib/file-names'
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
    if (typeof value === 'string' && (standardOnly ? value !== '' : value.trim()))
      metadata[name] = value
  }
  const keywords = source.Keywords ?? source.keywords
  if (Array.isArray(keywords) && keywords.every((item) => typeof item === 'string')) {
    metadata.Keywords = keywords
  } else if (typeof keywords === 'string' && (standardOnly ? keywords !== '' : keywords.trim())) {
    metadata.Keywords = standardOnly
      ? keywords
      : keywords
          .split(',')
          .map((word) => word.trim())
          .filter(Boolean)
  }
  const editable = JSON.stringify(metadata)
  return editable
}

/** V9 applies a shared outline to every output, rather than a filename-keyed map. */
export function canImportPdfStructure(
  operation: string,
  isV9: boolean,
  filenames: readonly string[],
): boolean {
  const fileCount = filenames.length
  if (operation === 'metadata-write' || (isV9 && operation === 'bookmarks-write'))
    return fileCount === 1
  return (
    operation === 'bookmarks-write' &&
    fileCount > 0 &&
    new Set(filenames.map(filenameKey)).size === fileCount
  )
}

/** Preserve the filename-to-bookmarks map so existing source page numbers stay local. */
export function importReadableBookmarks(
  result: unknown,
  filenames: string[],
  { native = false }: { native?: boolean } = {},
): string {
  if (!isObject(result) || !filenames.length) throw new Error('Invalid bookmark read response.')
  if (new Set(filenames.map(filenameKey)).size !== filenames.length) {
    throw new Error('Cannot import bookmarks for duplicate PDF filenames. Rename the files first.')
  }
  const mapped: Record<string, unknown> = Object.create(null)
  for (const filename of filenames) {
    const items = result[filename] ?? result[filename.normalize('NFC')]
    if (!Array.isArray(items))
      throw new Error(`Gotenberg did not return bookmarks for ${filename}.`)
    mapped[filename] = items.map(normalizeReadBookmark)
  }
  const value =
    filenames.length === 1 ? JSON.stringify(mapped[filenames[0] as string]) : JSON.stringify(mapped)
  validateBookmarkDocument(value, { allowNativePageNumber: native })
  return value
}

/** Convert the v9 pageNumber JSON back to the existing v8-compatible editor shape. */
function normalizeReadBookmark(value: unknown): unknown {
  if (!isObject(value)) return value
  const { pageNumber, children, ...rest } = value
  if (pageNumber !== undefined && rest.page !== undefined && pageNumber !== rest.page) {
    throw new Error('The bookmark response contains conflicting page numbers.')
  }
  return {
    ...rest,
    ...(pageNumber !== undefined ? { page: pageNumber } : {}),
    ...(children != null
      ? { children: Array.isArray(children) ? children.map(normalizeReadBookmark) : children }
      : {}),
  }
}

/** A corrupt UTF-8 response must never overwrite existing document structure. */
export async function readPdfStructureResponse(blob: Blob): Promise<unknown> {
  if (blob.size > 2_000_000) throw new Error('The PDF structure response is too large to edit.')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()))
}
