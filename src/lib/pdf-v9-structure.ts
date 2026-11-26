import { isPdfMetadataDate } from '#/lib/pdf-metadata-date'
import { metadataObject, V9_METADATA_KEY_MAP } from '#/lib/pdf-structure-editors'
import { hasMalformedUnicode } from '#/lib/unicode-text'
import { InputError } from '#/lib/validation'

/** Shared preflight and wire encoding for writable Gotenberg 9 PDF structure. */
export function v9MetadataFields(raw: string): Record<string, string> {
  const source = metadataObject(raw)
  const translated: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    const key = Object.hasOwn(V9_METADATA_KEY_MAP, name)
      ? V9_METADATA_KEY_MAP[name]
      : Object.values(V9_METADATA_KEY_MAP).includes(name)
        ? name
        : null
    if (!key) throw new InputError(`Gotenberg 9 cannot write the v8 metadata key '${name}'.`)
    const normalized =
      key === 'keywords' && Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? value.join(', ')
        : value
    if (typeof normalized !== 'string')
      throw new InputError(`Gotenberg 9 metadata '${name}' must be a string.`)
    if ((key === 'creationDate' || key === 'modDate') && !isPdfMetadataDate(normalized)) {
      throw new InputError(
        `Gotenberg 9 metadata '${name}' must be a PDF date such as D:20261001090000Z.`,
      )
    }
    if (Object.hasOwn(translated, key)) {
      throw new InputError(`Gotenberg 9 metadata contains conflicting aliases for '${key}'.`)
    }
    translated[key] = normalized
  }
  return translated
}

export function v9BookmarkTree(raw: string): unknown[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new InputError('Invalid bookmark JSON.')
  }
  if (!Array.isArray(decoded)) {
    throw new InputError(
      'Gotenberg 9 requires one shared bookmark tree. Per-filename bookmark maps are supported by Gotenberg 8 only.',
    )
  }
  if (!decoded.length) throw new InputError('Gotenberg 9 requires at least one bookmark.')
  if (hasMalformedUnicode(decoded)) throw new InputError('Bookmarks contain malformed Unicode.')
  return toV9Bookmarks(decoded)
}

function toV9Bookmarks(nodes: unknown[]): unknown[] {
  return nodes.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node))
      throw new InputError('Every bookmark must be an object.')
    const entry = node as Record<string, unknown>
    if (
      Object.keys(entry).some((key) => !['title', 'page', 'pageNumber', 'children'].includes(key))
    ) {
      throw new InputError('Gotenberg 9 does not support extra bookmark properties in this editor.')
    }
    if (
      entry.page !== undefined &&
      entry.pageNumber !== undefined &&
      entry.page !== entry.pageNumber
    ) {
      throw new InputError('A bookmark cannot specify different page and pageNumber values.')
    }
    const pageNumber = entry.pageNumber ?? entry.page
    if (
      !Number.isSafeInteger(pageNumber) ||
      (pageNumber as number) < 1 ||
      typeof entry.title !== 'string' ||
      /^\p{White_Space}*$/u.test(entry.title)
    ) {
      throw new InputError('Each bookmark needs a title and a positive page number.')
    }
    if (entry.children !== undefined && entry.children !== null && !Array.isArray(entry.children))
      throw new InputError('Bookmark children must be an array.')
    return {
      title: entry.title,
      pageNumber,
      ...(entry.children ? { children: toV9Bookmarks(entry.children) } : {}),
    }
  })
}
