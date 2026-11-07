/** Accept printable punctuation and Unicode without allowing paths or controls.
 * Gotenberg strips separators/controls and NFC-normalises upload filenames.
 */
export function safeFilename(name: string): string {
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    /[/\\]/u.test(name) ||
    [...name].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    throw new Error('File names must not be empty, paths or contain control characters.')
  }
  return name
}

/** Gotenberg NFC-normalises filenames, but resolves them case-sensitively. */
export const filenameKey = (name: string): string => name.normalize('NFC')

/** Preserve upload arrival order. Gotenberg compares NFC-normalised filenames
 * case-sensitively and auto-renames repeated source documents in major 9.
 */
export function combineUploadSelection(
  existing: readonly File[],
  incoming: readonly File[],
  options: { multiple?: boolean; allowDuplicateNames?: boolean; maxFiles?: number } = {},
): File[] {
  const names = new Set<string>()
  return [...(options.multiple ? existing : []), ...incoming]
    .filter((file) => {
      if (options.allowDuplicateNames) return true
      const name = filenameKey(file.name)
      if (names.has(name)) return false
      names.add(name)
      return true
    })
    .slice(0, options.maxFiles ?? Number.POSITIVE_INFINITY)
}
