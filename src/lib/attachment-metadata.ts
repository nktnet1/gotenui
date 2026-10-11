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
  // Mirror the proxy's simple-filename contract; do not silently trim a name,
  // because embedsMetadata keys must exactly match Content-Disposition or uploads.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.()-]{0,150}$/.test(name) || name === '.' || name === '..') {
    throw new Error(
      'Use an exact simple attachment filename without folders or special characters.',
    )
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
  if (key === 'mimeType' && value && !/^[\w.+-]+\/[\w.+-]+$/.test(value)) {
    throw new Error('MIME type must look like application/xml or image/png.')
  }
  if (
    key === 'relationship' &&
    value &&
    !ATTACHMENT_RELATIONSHIPS.includes(value as AttachmentRelationship)
  ) {
    throw new Error('Choose a supported PDF/A attachment relationship.')
  }
  const entry: AttachmentMetadata = { ...current[name] }
  if (value) {
    if (key === 'relationship') entry.relationship = value as AttachmentRelationship
    else entry.mimeType = value
  } else {
    delete entry[key]
  }
  const next = { ...current }
  if (Object.keys(entry).length) next[name] = entry
  else delete next[name]
  return serialized(next)
}

/** Add metadata for a remote attachment whose filename is not in local uploads. */
export function addRemoteAttachmentMetadata(raw: string | undefined, filename: string): string {
  const current = checkedMetadata(raw)
  const name = checkedFilename(filename)
  if (Object.keys(current).some((item) => item.toLowerCase() === name.toLowerCase())) {
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
