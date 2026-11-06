/** Browser-only, bounded ZIP directory inspection. Never unpack executable or
 * document bytes: only display names and declared sizes from the central directory.
 * The downloaded Blob remains untouched if the index is unsupported or malformed.
 */
const MAX_DIRECTORY_BYTES = 512_000
const MAX_VISIBLE_FILES = 30
const MAX_ZIP_COMMENT_BYTES = 65_535
const END_RECORD_BYTES = 22

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

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('Incomplete ZIP directory.')
  return view.getUint16(offset, true)
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('Incomplete ZIP directory.')
  return view.getUint32(offset, true)
}

function entryKind(name: string): ZipResultEntry['kind'] {
  if (/\.pdf$/i.test(name)) return 'PDF'
  if (/\.(?:png|jpe?g|webp|gif|tiff?)$/i.test(name)) return 'Image'
  return 'Other'
}

function displayName(name: string): string {
  // A malicious archive name is only displayed; no path is ever extracted.
  return Array.from(name)
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
    .slice(0, 160)
}

/** Read at most ~576 KiB regardless of the total downloaded archive size. */
export async function inspectZipResult(blob: Blob): Promise<ZipResultManifest> {
  if (blob.size < END_RECORD_BYTES) throw new Error('ZIP directory is missing.')
  const tailStart = Math.max(0, blob.size - END_RECORD_BYTES - MAX_ZIP_COMMENT_BYTES)
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer())
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let end = -1
  for (let offset = tail.length - END_RECORD_BYTES; offset >= 0; offset--) {
    if (readUint32(tailView, offset) !== 0x06054b50) continue
    if (offset + END_RECORD_BYTES + readUint16(tailView, offset + 20) === tail.length) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('ZIP directory is missing.')
  // Multi-volume and ZIP64 archives need more complex indexing. Preserve their
  // downloads, but do not attempt to interpret their indexes in the browser.
  const totalFiles = readUint16(tailView, end + 10)
  const directorySize = readUint32(tailView, end + 12)
  const directoryOffset = readUint32(tailView, end + 16)
  if (
    readUint16(tailView, end + 4) !== 0 ||
    readUint16(tailView, end + 6) !== 0 ||
    readUint16(tailView, end + 8) !== totalFiles ||
    totalFiles === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    directorySize > MAX_DIRECTORY_BYTES ||
    directoryOffset + directorySize > tailStart + end
  ) {
    throw new Error('This ZIP directory is too large or uses an unsupported format.')
  }
  const directory = new Uint8Array(
    await blob.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer(),
  )
  if (directory.length !== directorySize) throw new Error('ZIP directory is incomplete.')
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
  let cursor = 0
  let fileCount = 0
  let totalUncompressedBytes = 0
  const entries: ZipResultEntry[] = []
  const decoder = new TextDecoder('utf-8', { fatal: false })
  for (let i = 0; i < totalFiles; i++) {
    if (cursor + 46 > directory.length) throw new Error('Truncated ZIP directory entry.')
    if (readUint32(view, cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.')
    const size = readUint32(view, cursor + 24)
    const filenameLength = readUint16(view, cursor + 28)
    const extraLength = readUint16(view, cursor + 30)
    const commentLength = readUint16(view, cursor + 32)
    const next = cursor + 46 + filenameLength + extraLength + commentLength
    if (next > directory.length) throw new Error('Truncated ZIP directory entry.')
    if (size === 0xffffffff) throw new Error('ZIP64 entries cannot be previewed.')
    const name = displayName(
      decoder.decode(directory.subarray(cursor + 46, cursor + 46 + filenameLength)),
    )
    if (!name.endsWith('/')) {
      fileCount++
      totalUncompressedBytes += size
      if (entries.length < MAX_VISIBLE_FILES) {
        entries.push({ id: cursor, name, size, kind: entryKind(name) })
      }
    }
    cursor = next
  }
  if (cursor !== directory.length) throw new Error('Unexpected ZIP directory contents.')
  return { entries, totalFiles: fileCount, totalUncompressedBytes }
}
