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

/** An empty official filename override means "not set". Match the name that
 * the v9 multipart adapter sends, including when a legacy name hint exists.
 */
export function effectiveRemoteFilename(remote: {
  filename?: string
  name?: string
}): string | undefined {
  return remote.filename || remote.name || undefined
}

/** Gotenberg 9 can also infer the filename from the URL path if no override
 * or Content-Disposition filename is present. Use this only when checking for
 * potential name collisions, not when resolving an exact stage asset.
 */
export function possibleRemoteFilename(remote: {
  url: string
  filename?: string
  name?: string
}): string | undefined {
  const explicit = effectiveRemoteFilename(remote)
  if (explicit) return explicit
  try {
    // Go's url.Parse decodes Path, then path.Base strips trailing slashes.
    // SanitizeFilename subsequently strips backslashes and control characters.
    const pathname = decodeURIComponent(new URL(remote.url).pathname)
    const base = pathname.replace(/\/+$/u, '').split('/').at(-1) ?? ''
    const filename = [...(base.split('\\').at(-1) ?? '')]
      .filter((character) => {
        const code = character.codePointAt(0) ?? 0
        return code >= 32 && code !== 127
      })
      .join('')
      .normalize('NFC')
    const extension = filename.slice(filename.lastIndexOf('.'))
    return extension.length >= 2 && extension !== filename ? filename : undefined
  } catch {
    return undefined
  }
}

/** Mirror Gotenberg uniqueFilename in registration order, including names
 * already occupied by earlier numbered duplicates.
 */
export function registeredFilenames(names: readonly string[]): string[] {
  const occupied = new Set<string>()
  const nextSuffix = new Map<string, number>()
  return names.map((raw) => {
    const name = filenameKey(raw)
    if (!occupied.has(name)) {
      occupied.add(name)
      return name
    }
    const dot = name.lastIndexOf('.')
    const stem = dot === -1 ? name : name.slice(0, dot)
    const extension = dot === -1 ? '' : name.slice(dot)
    let suffix = nextSuffix.get(name) ?? 2
    let candidate = `${stem} (${suffix})${extension}`
    while (occupied.has(candidate)) {
      suffix++
      candidate = `${stem} (${suffix})${extension}`
    }
    occupied.add(candidate)
    nextSuffix.set(name, suffix + 1)
    return candidate
  })
}

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
