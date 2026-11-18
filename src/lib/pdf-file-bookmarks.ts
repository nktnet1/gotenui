import { InputError } from '#/lib/validation'

/** Gotenberg 9.7 merge option. Missing label sources fall back to the filename. */
export type FileBookmarks = {
  label?: ('title' | 'filename')[]
  labels?: Record<string, string>
}

export function validateFileBookmarks(value: unknown): asserts value is FileBookmarks {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('merge: fileBookmarks must be a JSON object.')
  }
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).some((key) => key !== 'label' && key !== 'labels')) {
    throw new InputError('merge: fileBookmarks accepts only label and labels.')
  }
  if (
    fields.label != null &&
    (!Array.isArray(fields.label) ||
      fields.label.some((item) => item !== 'title' && item !== 'filename'))
  ) {
    throw new InputError('merge: fileBookmarks.label accepts title and filename only.')
  }
  if (fields.labels != null) {
    if (
      typeof fields.labels !== 'object' ||
      Array.isArray(fields.labels) ||
      Object.entries(fields.labels).some(
        ([name, label]) => !name || typeof label !== 'string' || !label.trim(),
      )
    ) {
      throw new InputError(
        'merge: fileBookmarks.labels must map PDF filenames to non-blank labels.',
      )
    }
  }
}

/** The UI uses original upload names, while merge sends numbered names for stable ordering. */
export function mapFileBookmarkLabels(
  bookmarks: FileBookmarks,
  inputs: readonly { original: string; forwarded: string }[],
  { preferForwarded = false }: { preferForwarded?: boolean } = {},
): FileBookmarks {
  const filenameOnly = bookmarks.label?.[0] === 'filename'
  if (!bookmarks.labels && !filenameOnly) return bookmarks
  const labels: Record<string, string> = Object.create(null)
  if (filenameOnly) {
    // Uploaded merge files carry order prefixes such as 01_. Explicit labels
    // restore the original filenames without overriding a PDF title mode.
    for (const { original, forwarded } of inputs) {
      const basename = original.replace(/\.[^.]+$/, '')
      labels[forwarded.normalize('NFC')] = basename.trim() ? basename : original
    }
  }
  const assigned = new Set<string>()
  for (const [original, label] of Object.entries(bookmarks.labels ?? {})) {
    const normalized = original.normalize('NFC')
    const forwardedMatches = preferForwarded
      ? inputs.filter((item) => item.forwarded.normalize('NFC') === normalized)
      : []
    const matched = forwardedMatches.length
      ? forwardedMatches
      : inputs.filter((item) => item.original.normalize('NFC') === normalized)
    const targets = matched.length
      ? matched.map(({ forwarded }) => forwarded.normalize('NFC'))
      : [original.normalize('NFC')]
    for (const name of targets) {
      if (assigned.has(name)) {
        throw new InputError(`merge: duplicate fileBookmarks label for ${name}.`)
      }
      assigned.add(name)
      labels[name] = label
    }
  }
  return { ...bookmarks, labels }
}
