/** Prefix local merge inputs so Gotenberg's filename sort follows the visible order. */
export function mergeUploadFilename(filename: string, index: number, count: number): string {
  const prefix = String(index + 1).padStart(Math.max(2, String(count).length), '0')
  return `${prefix}_${filename}`
}

/** Reserve stage asset names when numbering pipeline merge inputs. The rank
 * stays at the start, so disambiguation never changes Gotenberg's merge order.
 */
export function mergeUploadFilenames(
  filenames: readonly string[],
  reservedNames: readonly string[] = [],
): string[] {
  const occupied = new Set(reservedNames.map((name) => name.normalize('NFC')))
  return filenames.map((filename, index) => {
    let disambiguator = ''
    let renamed = mergeUploadFilename(filename, index, filenames.length)
    while (occupied.has(renamed.normalize('NFC'))) {
      disambiguator += '_'
      renamed = mergeUploadFilename(`${disambiguator}${filename}`, index, filenames.length)
    }
    occupied.add(renamed.normalize('NFC'))
    return renamed
  })
}

/** Reconcile the legacy encoder's numbered input names with Gotenberg 9 assets.
 * Preserve the numeric prefix so generated names continue to sort in upload order.
 */
export function reservePrefixedMergeUploadNames(
  prefixedNames: readonly string[],
  reservedNames: readonly string[] = [],
): string[] {
  const originals = prefixedNames.map((name, index) => {
    const prefix = mergeUploadFilename('', index, prefixedNames.length)
    return name.startsWith(prefix) ? name.slice(prefix.length) : name
  })
  return mergeUploadFilenames(originals, reservedNames)
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
