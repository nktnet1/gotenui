import {
  findZipEndRecord,
  hasZipDirectoryHeaderAt,
  ZIP_END_RECORD_BYTES,
  ZIP_END_SEARCH_BYTES,
  zipDirectoryEntries,
  zipEntryIsDirectory,
} from '#/lib/zip-directory'

/** Browser-only, bounded ZIP directory inspection. Never unpack executable or
 * document bytes: only display names and declared sizes from the central directory.
 * The downloaded Blob remains untouched if the index is unsupported or malformed.
 */
const MAX_DIRECTORY_BYTES = 512_000
const MAX_VISIBLE_FILES = 30

export type ZipResultEntry = {
  id: number
  name: string
  size: number
  kind: 'PDF' | 'Image' | 'Other'
}

export type ZipResultManifest = {
  entries: ZipResultEntry[]
  totalFiles: number
  totalUncompressedBytes: number
}

function entryKind(name: string): ZipResultEntry['kind'] {
  if (/\.pdf$/i.test(name)) return 'PDF'
  if (/\.(?:png|jpe?g|webp|gif|tiff?)$/i.test(name)) return 'Image'
  return 'Other'
}

function displayName(name: string): string {
  // A malicious archive name is only displayed; no path is ever extracted.
  return Array.from(name)
    .slice(0, 160)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 ||
        code === 127 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
        ? '_'
        : character
    })
    .join('')
}

/** Read only the bounded directory, footer and optional directory header probe. */
export async function inspectZipResult(blob: Blob): Promise<ZipResultManifest> {
  if (blob.size < ZIP_END_RECORD_BYTES) throw new Error('ZIP directory is missing.')
  const tailStart = Math.max(0, blob.size - ZIP_END_SEARCH_BYTES)
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer())
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const end = findZipEndRecord(tailView)
  if (end < 0) throw new Error('ZIP directory is missing.')
  // Multi-volume and ZIP64 archives need more complex indexing. Preserve their
  // downloads, but do not attempt to interpret their indexes in the browser.
  const totalFiles = tailView.getUint16(end + 10, true)
  const directorySize = tailView.getUint32(end + 12, true)
  const declaredOffset = tailView.getUint32(end + 16, true)
  const baseOffset = tailStart + end - declaredOffset - directorySize
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== totalFiles ||
    totalFiles === 0xffff ||
    directorySize === 0xffffffff ||
    declaredOffset === 0xffffffff ||
    directorySize > MAX_DIRECTORY_BYTES ||
    baseOffset < 0
  ) {
    throw new Error('This ZIP directory is too large or uses an unsupported format.')
  }
  // Go supports prepended archives with relative offsets, but first probes
  // the declared absolute offset if a prefix is present. Display the same
  // central directory that the upload inspector would use.
  const directoryOffset =
    baseOffset > 0 && (await hasZipDirectoryHeaderAt(blob, declaredOffset))
      ? declaredOffset
      : declaredOffset + baseOffset
  const directory = new Uint8Array(
    await blob.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer(),
  )
  if (directory.length !== directorySize) throw new Error('ZIP directory is incomplete.')
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
  let fileCount = 0
  let totalUncompressedBytes = 0
  const entries: ZipResultEntry[] = []
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
  for (const { offset, nameBytes, size, creator, attributes } of zipDirectoryEntries(
    view,
    totalFiles,
  )) {
    if (size === 0xffffffff) throw new Error('ZIP64 entries cannot be previewed.')
    const name = decoder.decode(nameBytes)
    if (!zipEntryIsDirectory(creator, attributes, name)) {
      fileCount++
      totalUncompressedBytes += size
      if (entries.length < MAX_VISIBLE_FILES) {
        entries.push({ id: offset, name: displayName(name), size, kind: entryKind(name) })
      }
    }
  }
  return { entries, totalFiles: fileCount, totalUncompressedBytes }
}
