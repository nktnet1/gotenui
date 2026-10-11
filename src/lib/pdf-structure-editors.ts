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
  let count = 0
  const checkList = (list: unknown, label: string, depth: number): void => {
    if (!Array.isArray(list)) throw new Error(`${label} must be a list of bookmarks.`)
    if (depth > 16) throw new Error('Bookmark nesting exceeds 16 levels.')
    for (const [index, item] of list.entries()) {
      const where = `${label} item ${index + 1}`
      if (!isRecord(item)) throw new Error(`${where} must be an object.`)
      count++
      if (count > 300) throw new Error('A request cannot contain more than 300 bookmarks.')
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300) {
        throw new Error(`${where} needs a title (up to 300 characters).`)
      }
      if (!Number.isSafeInteger(item.page) || (item.page as number) < 1) {
        throw new Error(`${where} needs a positive whole-number page (starting at 1).`)
      }
      if (item.children !== undefined) checkList(item.children, `${where} children`, depth + 1)
    }
  }
  if (Array.isArray(value)) {
    checkList(value, 'Bookmarks', 1)
    return
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('Bookmarks must be a list or a filename-to-bookmarks map.')
  }
  for (const [filename, list] of Object.entries(value)) {
    if (
      !filename ||
      filename.length > 255 ||
      /[/\\]/.test(filename) ||
      [...filename].some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new Error('Bookmark map keys must be plain PDF filenames.')
    }
    checkList(list, `Bookmarks for ${filename}`, 1)
  }
}

/** A filename-keyed map stays in raw JSON mode rather than being silently flattened. */
export function visualBookmarkList(text: string): BookmarkNode[] | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const convert = (list: unknown, depth: number): BookmarkNode[] | null => {
    if (!Array.isArray(list) || depth > 8 || list.length > 300) return null
    const nodes: BookmarkNode[] = []
    for (const item of list) {
      if (
        !isRecord(item) ||
        typeof item.title !== 'string' ||
        (typeof item.page !== 'number' && typeof item.page !== 'string')
      ) {
        return null
      }
      const children = convert(item.children ?? [], depth + 1)
      if (!children) return null
      nodes.push({ ...item, title: item.title, page: item.page, children })
    }
    return nodes
  }
  return convert(value, 1)
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
    if (path.length >= 8 || JSON.stringify(root).length > 9500) {
      throw new Error('Bookmark tree is too large for the visual editor.')
    }
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
