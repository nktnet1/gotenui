import { filenameKey, possibleRemoteFilename, registeredFilenames } from '#/lib/file-names'

/** Prefix local merge inputs so Gotenberg's filename sort follows the visible order. */
export function mergeUploadFilename(filename: string, index: number, count: number): string {
  const prefix = String(index + 1).padStart(Math.max(2, String(count).length), '0')
  return `${prefix}_${filename}`
}

/** Preserve remote filenames that the encoder may pin from the URL on v9.2+.
 * Older servers can still return these names in Content-Disposition.
 */
export function remoteMergeFilenames(
  remotes: readonly { url: string; name?: string; filename?: string }[] = [],
): string[] {
  return remotes.flatMap((remote) => {
    const name = possibleRemoteFilename(remote)
    return name ? [name] : []
  })
}

/** A merge before any compose renames local inputs to preserve upload order.
 * The Office Merge switch always numbers its inputs, even a single document.
 */
export function numbersPipelineInputs(
  stages: readonly { op: string }[],
  inputCount: number,
  builtInMerge = false,
): boolean {
  const firstMerge = stages.findIndex(({ op }) => op === 'merge')
  const firstCompose = stages.findIndex(({ op }) => op === 'compose')
  return (
    firstMerge !== -1 &&
    (builtInMerge || (inputCount > 1 && (firstCompose === -1 || firstCompose > firstMerge)))
  )
}

/** Reserve stage asset names when numbering pipeline merge inputs. The rank
 * stays at the start, so disambiguation never changes Gotenberg's merge order.
 */
export function mergeUploadFilenames(
  filenames: readonly string[],
  reservedNames: readonly string[] = [],
): string[] {
  const occupied = new Set(registeredFilenames(reservedNames))
  return filenames.map((filename, index) => {
    let disambiguator = ''
    let renamed = mergeUploadFilename(filename, index, filenames.length)
    while (occupied.has(filenameKey(renamed))) {
      disambiguator += '_'
      renamed = mergeUploadFilename(`${disambiguator}${filename}`, index, filenames.length)
    }
    occupied.add(filenameKey(renamed))
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
