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

type RemoteFilenameInput = { url: string; name?: string; filename?: string }

/** Predict exactly which names the multipart encoder can pin. Keep legacy
 * hints on older backends, but infer names only where an override is supported.
 */
export function planRemoteFilenames(
  remotes: readonly RemoteFilenameInput[],
  options: {
    supportsFilename: boolean
    inferAll: boolean
    pinAll: boolean
    stageAssetNames: ReadonlySet<string>
  },
): { name: string | undefined; required: boolean }[] {
  const lastNamedAsset = options.supportsFilename
    ? remotes.reduce((last, remote, index) => {
        const name = effectiveRemoteFilename(remote)
        return name !== undefined && options.stageAssetNames.has(filenameKey(name)) ? index : last
      }, -1)
    : -1
  return remotes.map((remote, index) => {
    const required = options.supportsFilename && (options.pinAll || index < lastNamedAsset)
    const infer = options.supportsFilename && (required || options.inferAll)
    return {
      name: effectiveRemoteFilename(remote) ?? (infer ? possibleRemoteFilename(remote) : undefined),
      required,
    }
  })
}

/** The editor and encoder must reject the same missing filename overrides. */
export function remoteFilenamePlanReason(
  plan: readonly { name: string | undefined; required: boolean }[],
): string | null {
  return plan.some(({ name, required }) => required && !name)
    ? 'Specify a remote filename for downloads whose URL has no file extension when named assets could be shadowed.'
    : null
}

export const CHROMIUM_REMOTE_FILENAME_VERSION_REASON =
  'Chromium remote downloads alongside local assets require Gotenberg 9.2 or newer to pin their filenames.'

/** Use the actual filename override emitted by the multipart encoder when
 * reconciling PDF sources. An older server's explicit name hint remains an
 * expected filename, not an upstream override.
 */
export function forwardedRemoteFilenames(
  form: FormData,
  remotes: readonly RemoteFilenameInput[] = [],
): (string | undefined)[] {
  const raw = form.get('downloadFrom')
  const encoded = typeof raw === 'string' ? (JSON.parse(raw) as RemoteFilenameInput[]) : []
  return remotes.map((remote, index) => encoded[index]?.filename || effectiveRemoteFilename(remote))
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
