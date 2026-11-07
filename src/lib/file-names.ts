/** Accept printable punctuation and Unicode without allowing paths or controls.
 * Gotenberg strips separators/controls and NFC-normalises upload filenames.
 */
export function safeFilename(name: string): string {
  if (
    !name.trim() ||
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
