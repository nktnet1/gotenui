import { filenameKey, safeFilename } from '#/lib/file-names'

/** Common XMP keys supported by Gotenberg's metadata/write route. */
export const METADATA_TEXT_FIELDS = [
  { name: 'Title', label: 'Title', placeholder: 'Document title' },
  { name: 'Author', label: 'Author', placeholder: 'Author or organisation' },
  { name: 'Subject', label: 'Subject', placeholder: 'Document subject' },
  { name: 'Creator', label: 'Creator', placeholder: 'Creating application' },
  { name: 'Producer', label: 'Producer', placeholder: 'PDF producer' },
  { name: 'Copyright', label: 'Copyright', placeholder: 'Copyright statement' },
] as const

export type MetadataTextKey = (typeof METADATA_TEXT_FIELDS)[number]['name']
export type MetadataKey = MetadataTextKey | 'Keywords'

/** Match Gotenberg 8.39's ExifTool option and filesystem pseudo-tag protections. */
const EXIFTOOL_OPTIONS = new Set([
  'addtagsfromfile',
  'alltagsfromfile',
  'api',
  'argfile',
  'charset',
  'common_args',
  'config',
  'csv',
  'diff',
  'echo',
  'efile',
  'execute',
  'ext',
  'fileorder',
  'geotag',
  'geosync',
  'htmldump',
  'if',
  'j',
  'json',
  'lang',
  'listitem',
  'o',
  'out',
  'p',
  'php',
  'require',
  'srcfile',
  'stay_open',
  'tagsfromfile',
  'textout',
  'use',
  'w',
  'wm',
  'xmlformat',
])
const EXIFTOOL_FILESYSTEM_TAGS = new Set([
  'filename',
  'directory',
  'hardlink',
  'symlink',
  'filepermissions',
])

export function metadataObject(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Metadata must be a valid JSON object.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Metadata must be a JSON object, not an array or null.')
  }
  for (const key of Object.keys(value)) {
    if (!/^[a-zA-Z0-9_.:][a-zA-Z0-9\-_.:]*$/.test(key)) {
      throw new Error(`Metadata key "${key}" contains unsupported characters.`)
    }
    if (!key.includes(':') && EXIFTOOL_OPTIONS.has(key.toLowerCase())) {
      throw new Error(`Metadata key "${key}" is an ExifTool option. Use a group prefix.`)
    }
    if (EXIFTOOL_FILESYSTEM_TAGS.has(key.split(':').at(-1)?.toLowerCase() ?? '')) {
      throw new Error(`Metadata key "${key}" is not a writable PDF metadata tag.`)
    }
  }
  return value as Record<string, unknown>
}

/** Unknown XMP keys stay untouched when a common field is edited visually. */
export function updateMetadata(text: string, key: MetadataKey, nextValue: string): string {
  const data = { ...metadataObject(text) }
  if (!nextValue.trim()) {
    delete data[key]
  } else if (key === 'Keywords') {
    data.Keywords = nextValue
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
  } else {
    data[key] = nextValue
  }
  return JSON.stringify(data)
}

/** Only strings and keyword lists are represented by the simple metadata editor. */
export function visualMetadataValue(
  data: Record<string, unknown>,
  key: MetadataKey,
): string | null {
  const value = data[key]
  if (value === undefined || value === null) return ''
  if (
    key === 'Keywords' &&
    Array.isArray(value) &&
    value.every((word) => typeof word === 'string')
  ) {
    return value.join(', ')
  }
  return typeof value === 'string' ? value : null
}

export type BookmarkNode = {
  title: string
  page: number | string
  children: BookmarkNode[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The server validates the structure for either documented bookmarks payload shape. */
export function validateBookmarkDocument(text: string): void {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Bookmarks must contain valid JSON.')
  }
  const checkList = (list: unknown, label: string): void => {
    const pending: { list: unknown; label: string }[] = [{ list, label }]
    while (pending.length) {
      const current = pending.pop()
      if (!current) break
      if (!Array.isArray(current.list))
        throw new Error(`${current.label} must be a list of bookmarks.`)
      for (const [index, item] of current.list.entries()) {
        const where = `${current.label} item ${index + 1}`
        if (!isRecord(item)) throw new Error(`${where} must be an object.`)
        if (typeof item.title !== 'string' || !item.title.trim()) {
          throw new Error(`${where} needs a title.`)
        }
        if (!Number.isSafeInteger(item.page) || (item.page as number) < 1) {
          throw new Error(`${where} needs a positive whole-number page (starting at 1).`)
        }
        if (item.children !== undefined)
          pending.push({ list: item.children, label: `${where} children` })
      }
    }
  }
  if (Array.isArray(value)) {
    checkList(value, 'Bookmarks')
    return
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('Bookmarks must be a list or a filename-to-bookmarks map.')
  }
  for (const [filename, list] of Object.entries(value)) {
    try {
      safeFilename(filename)
    } catch {
      throw new Error('Bookmark map keys must be plain PDF filenames.')
    }
    checkList(list, `Bookmarks for ${filename}`)
  }
}

function convertBookmarkList(value: unknown): BookmarkNode[] | null {
  if (!Array.isArray(value)) return null
  const root: BookmarkNode[] = []
  const pending: { source: unknown; output: BookmarkNode[] }[] = [{ source: value, output: root }]
  while (pending.length) {
    const current = pending.pop()
    if (!current) break
    if (!Array.isArray(current.source)) return null
    for (const item of current.source) {
      if (
        !isRecord(item) ||
        typeof item.title !== 'string' ||
        (typeof item.page !== 'number' && typeof item.page !== 'string')
      ) {
        return null
      }
      const children: BookmarkNode[] = []
      current.output.push({ ...item, title: item.title, page: item.page, children })
      pending.push({ source: item.children ?? [], output: children })
    }
  }
  return root
}

/** A filename-keyed map stays in raw JSON mode rather than being silently flattened. */
export function visualBookmarkList(text: string): BookmarkNode[] | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return convertBookmarkList(value)
}

export type BookmarkEdit =
  | { kind: 'add'; parent: number[] }
  | { kind: 'update'; path: number[]; field: 'title' | 'page'; value: string }
  | { kind: 'remove'; path: number[] }
  | { kind: 'move'; path: number[]; direction: -1 | 1 }

/** Immutable JSON transformation, with paths indexing siblings at each tree level. */
export function editBookmarks(text: string, edit: BookmarkEdit): string {
  const rows = visualBookmarkList(text)
  if (!rows) throw new Error('Switch to JSON to edit this bookmark structure.')
  const root = structuredClone(rows)
  const path = edit.kind === 'add' ? edit.parent : edit.path.slice(0, -1)
  let siblings = root
  for (const index of path) {
    const node: BookmarkNode | undefined = siblings[index]
    if (!node) throw new Error('Bookmark path does not exist.')
    siblings = node.children
  }
  if (edit.kind === 'add') {
    siblings.push({ title: 'New bookmark', page: 1, children: [] })
  } else {
    const index = edit.path.at(-1)
    if (index === undefined || !siblings[index]) throw new Error('Bookmark path does not exist.')
    if (edit.kind === 'remove') siblings.splice(index, 1)
    if (edit.kind === 'update') {
      const node = siblings[index]
      if (!node) throw new Error('Bookmark path does not exist.')
      if (edit.field === 'title') {
        node.title = edit.value
      } else {
        node.page =
          /^[1-9]\d*$/.test(edit.value) && Number.isSafeInteger(Number(edit.value))
            ? Number(edit.value)
            : edit.value
      }
    }
    if (edit.kind === 'move') {
      const destination = index + edit.direction
      if (destination < 0 || destination >= siblings.length) return text
      const current = siblings[index]
      const adjacent = siblings[destination]
      if (!current || !adjacent) throw new Error('Bookmark path does not exist.')
      siblings[index] = adjacent
      siblings[destination] = current
    }
  }
  return JSON.stringify(root)
}

/** In addition to a shared outline, Gotenberg accepts a filename-keyed bookmark map. */
export function visualBookmarkMap(text: string): Record<string, BookmarkNode[]> | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || Object.keys(value).length === 0) return null
  const mapped: Record<string, BookmarkNode[]> = Object.create(null)
  for (const [filename, items] of Object.entries(value)) {
    const visual = convertBookmarkList(items)
    if (!visual) return null
    mapped[filename] = visual
  }
  return mapped
}

export function addBookmarkMapping(text: string, filename: string): string {
  try {
    safeFilename(filename)
    if (!/\.pdf$/i.test(filename)) throw new Error('Not a PDF filename.')
  } catch {
    throw new Error('Enter a PDF filename without a path (for example: report.pdf).')
  }
  const tree = visualBookmarkList(text)
  const map = visualBookmarkMap(text)
  if (tree?.length) {
    throw new Error('Remove shared bookmarks before switching to per-file bookmarks.')
  }
  if (tree === null && map === null) throw new Error('Fix bookmarks JSON before adding a file.')
  if (map && Object.keys(map).some((existing) => filenameKey(existing) === filenameKey(filename)))
    throw new Error('This filename already has bookmarks.')
  return JSON.stringify({ ...map, [filename]: [] })
}

export function removeBookmarkMapping(text: string, filename: string): string {
  const map = visualBookmarkMap(text)
  if (!map || !Object.hasOwn(map, filename)) throw new Error('Bookmark filename not found.')
  const next = Object.fromEntries(Object.entries(map).filter(([name]) => name !== filename))
  return Object.keys(next).length ? JSON.stringify(next) : '[]'
}

export function editFileBookmarks(text: string, filename: string, edit: BookmarkEdit): string {
  const map = visualBookmarkMap(text)
  if (!map || !Object.hasOwn(map, filename)) throw new Error('Bookmark filename not found.')
  const updated = editBookmarks(JSON.stringify(map[filename]), edit)
  return JSON.stringify({ ...map, [filename]: JSON.parse(updated) })
}
