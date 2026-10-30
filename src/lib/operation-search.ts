import { GROUPS, OPERATIONS, type Operation } from '#/tools/registry'

/** Human search vocabulary; the UI is small enough that a search dependency isn't necessary. */
const KEYWORDS: Readonly<Record<string, string>> = {
  'url-pdf': 'url link webpage web page website chrome browser print',
  'html-pdf': 'markup web page template html5 render print',
  'markdown-pdf': 'md readme markdown text document',
  'office-pdf':
    'doc docx word xls xlsx excel ppt pptx powerpoint slides spreadsheet libreoffice odt ods odp',
  'url-shot': 'url screen capture webpage website browser image snapshot',
  'html-shot': 'html screen capture image snapshot render',
  'markdown-shot': 'md screen capture image snapshot',
  merge: 'combine join concatenate append assemble pdf documents',
  split: 'extract separate divide pages ranges intervals',
  pdfa: 'archive archival compliance accessible accessibility pdfua pdf a pdf ua',
  optimize: 'compress reduce shrink smaller filesize file size images',
  rotate: 'turn flip orientation pages',
  flatten: 'forms fields annotations remove interactivity',
  encrypt: 'password protect protection security permissions restrict',
  watermark: 'overlay background copyright confidential text image',
  stamp: 'overlay foreground approved text image',
  'metadata-read': 'inspect view details properties author pdf information',
  'metadata-write': 'edit update set properties author title keywords pdf information',
  'bookmarks-read': 'view inspect outline toc table of contents chapters',
  'bookmarks-write': 'edit set add outline toc table of contents chapters',
  embed: 'attach attachment files portfolio add include',
  'factur-x': 'invoice invoicing electronic billing xml e invoice zugferd cii',
}

const normalize = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Highest specificity wins: title, synonyms, summary, then options and group. */
function tokenScore(token: string, text: string, weight: number): number {
  if (!text) return 0
  if (text === token) return weight + 4
  const words = text.split(' ')
  if (words.includes(token)) return weight + 3
  // Prefer closer prefix completions (e.g. "compress" over "compliance" for "comp").
  let bestPrefix = 0
  for (const word of words) {
    if (word.startsWith(token)) bestPrefix = Math.max(bestPrefix, token.length / word.length)
  }
  return bestPrefix ? weight + 1 + bestPrefix : 0
}

export function searchOperations(
  query: string,
  operations: readonly Operation[] = OPERATIONS,
): Operation[] {
  const phrase = normalize(query)
  if (!phrase) return operations.filter((operation) => operation.featured)
  const tokens = phrase.split(' ')
  return operations
    .map((operation, order) => {
      const title = normalize(operation.title)
      const aliases = normalize(KEYWORDS[operation.id] ?? '')
      const summary = normalize(operation.summary)
      const group = normalize(operation.group)
      const fields = normalize(operation.fields.map((field) => field.label).join(' '))
      let score = title.includes(phrase) ? 30 : aliases.includes(phrase) ? 15 : 0
      for (const token of tokens) {
        const match = Math.max(
          tokenScore(token, title, 20),
          tokenScore(token, aliases, 16),
          tokenScore(token, summary, 9),
          tokenScore(token, fields, 5),
          tokenScore(token, group, 2),
        )
        if (!match) return { operation, score: 0, order }
        score += match
      }
      return { operation, score, order }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((result) => result.operation)
}

/** Keep relevance order while searching. Only the empty-state suggestions are grouped. */
export function visibleSearchOperations(query: string): Operation[] {
  const ranked = searchOperations(query)
  return query.trim()
    ? ranked
    : GROUPS.flatMap((group) => ranked.filter((operation) => operation.group === group))
}

export function nextSearchIndex(index: number, count: number, key: string): number | null {
  if (count === 0) return null
  if (key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowUp') return (index - 1 + count) % count
  return null
}

export function isSearchShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  )
}
