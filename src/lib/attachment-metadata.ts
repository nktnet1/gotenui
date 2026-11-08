import { filenameKey, safeFilename } from '#/lib/file-names'
/** Gotenberg 8.31+ PDF/A-3 attachment metadata, keyed by exact upload filename. */
export const ATTACHMENT_RELATIONSHIPS = [
  'Source',
  'Data',
  'Alternative',
  'Supplement',
  'Unspecified',
] as const

export type AttachmentRelationship = (typeof ATTACHMENT_RELATIONSHIPS)[number]
export type AttachmentMetadata = { mimeType?: string; relationship?: AttachmentRelationship }

/** Accept ordinary MIME types and parameterised media types without loosening
 * the no-control-character requirement for metadata sent upstream. */
export function isAttachmentMimeType(value: string): boolean {
  return (
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[^"\\\r\n]|\\.)*"))*$/.test(
      value,
    ) &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  )
}

export function parseAttachmentMetadata(
  raw: string | undefined,
): Record<string, AttachmentMetadata> | null {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    for (const details of Object.values(parsed)) {
      if (!details || typeof details !== 'object' || Array.isArray(details)) return null
      if (
        Object.entries(details).some(
          ([key, value]) =>
            (key !== 'mimeType' && key !== 'relationship') || typeof value !== 'string',
        )
      ) {
        return null
      }
    }
    return parsed as Record<string, AttachmentMetadata>
  } catch {
    return null
  }
}

function checkedMetadata(raw: string | undefined): Record<string, AttachmentMetadata> {
  const parsed = parseAttachmentMetadata(raw)
  if (!parsed) throw new Error('Fix the attachment metadata JSON before editing these fields.')
  return parsed
}

function checkedFilename(name: string): string {
  // Preserve the exact uploaded filename, including significant surrounding spaces.
  // Gotenberg's embedsMetadata map uses exact keys.
  try {
    safeFilename(name)
  } catch {
    throw new Error('Use the exact attachment filename without paths or control characters.')
  }
  return name
}

function serialized(data: Record<string, AttachmentMetadata>): string {
  return Object.keys(data).length ? JSON.stringify(data) : ''
}

export function setAttachmentMetadata(
  raw: string | undefined,
  filename: string,
  key: keyof AttachmentMetadata,
  input: string,
): string {
  const current = checkedMetadata(raw)
  const name = checkedFilename(filename)
  const value = input.trim()
  if (key === 'mimeType' && value && !isAttachmentMimeType(value)) {
    throw new Error('MIME type must look like application/xml or image/png.')
  }
  if (
    key === 'relationship' &&
    value &&
    !ATTACHMENT_RELATIONSHIPS.includes(value as AttachmentRelationship)
  ) {
    throw new Error('Choose a supported PDF/A attachment relationship.')
  }
  const entry: AttachmentMetadata = {
    ...(Object.hasOwn(current, name) ? current[name] : {}),
  }
  if (value) {
    if (key === 'relationship') entry.relationship = value as AttachmentRelationship
    else entry.mimeType = value
  } else {
    delete entry[key]
  }
  const next = { ...current }
  if (Object.keys(entry).length) {
    // Use an own data property even for special names such as '__proto__'.
    Object.defineProperty(next, name, {
      value: entry,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  } else {
    delete next[name]
  }
  return serialized(next)
}

/** Add metadata for a remote attachment whose filename is not in local uploads. */
export function addRemoteAttachmentMetadata(raw: string | undefined, filename: string): string {
  const current = checkedMetadata(raw)
  const name = checkedFilename(filename)
  if (Object.keys(current).some((item) => filenameKey(item) === filenameKey(name))) {
    throw new Error('This attachment already has a metadata entry.')
  }
  return serialized({ ...current, [name]: { relationship: 'Unspecified' } })
}

export function deleteAttachmentMetadata(raw: string | undefined, filename: string): string {
  const current = checkedMetadata(raw)
  const next = { ...current }
  delete next[filename]
  return serialized(next)
}
