/** Shared classic ZIP directory handling for bounded upload and result inspection. */
export const ZIP_END_RECORD_BYTES = 22
// Match archive/zip: the search allows a maximum comment and a short trailer.
export const ZIP_END_SEARCH_BYTES = 65 * 1024

export function findZipEndRecord(view: DataView): number {
  for (let offset = view.byteLength - ZIP_END_RECORD_BYTES; offset >= 0; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    // Do not look through a truncated newest EOCD for an older directory.
    if (offset + ZIP_END_RECORD_BYTES + view.getUint16(offset + 20, true) > view.byteLength) break
    return offset
  }
  return -1
}

/** Go probes the declared absolute directory offset before applying the
 * calculated preamble offset. Its header probe includes ZIP64 extra sizes.
 */
export async function hasZipDirectoryHeaderAt(archive: Blob, offset: number): Promise<boolean> {
  const bytes = await archive.slice(offset, offset + 46).arrayBuffer()
  if (bytes.byteLength !== 46) return false
  const header = new DataView(bytes)
  if (header.getUint32(0, true) !== 0x02014b50) return false
  const extraStart = offset + 46 + header.getUint16(28, true)
  const extraEnd = extraStart + header.getUint16(30, true)
  if (extraEnd + header.getUint16(32, true) > archive.size) return false
  return validDirectoryEntryZip64(
    header,
    new DataView(await archive.slice(extraStart, extraEnd).arrayBuffer()),
  )
}

/** The same ZIP64 rules apply to every central entry, not just the probe. */
export function validDirectoryEntryZip64(header: DataView, extra: DataView): boolean {
  const needUncompressed = header.getUint32(24, true) === 0xffffffff
  const needCompressed = header.getUint32(20, true) === 0xffffffff
  const needOffset = header.getUint32(42, true) === 0xffffffff
  if (!needUncompressed && !needCompressed && !needOffset) return true
  for (let cursor = 0; cursor + 4 <= extra.byteLength; ) {
    const tag = extra.getUint16(cursor, true)
    const length = extra.getUint16(cursor + 2, true)
    cursor += 4
    if (cursor + length > extra.byteLength) break
    if (tag === 1) {
      return length >= 8 * (Number(needUncompressed) + Number(needCompressed) + Number(needOffset))
    }
    cursor += length
  }
  // The Go reader tolerates a missing uncompressed size, but not the others.
  return !needCompressed && !needOffset
}

/** Permit a single optional central-directory digital signature record. */
export function validZipDirectoryEnd(directory: DataView, cursor: number): boolean {
  const remaining = directory.byteLength - cursor
  return (
    remaining === 0 ||
    (remaining >= 6 &&
      directory.getUint32(cursor, true) === 0x05054b50 &&
      6 + directory.getUint16(cursor + 4, true) === remaining)
  )
}

/** Directory flags used by archive/zip for Unix/macOS and DOS-family creators. */
export function zipEntryIsDirectory(creator: number, attributes: number, name: string): boolean {
  return (
    name.endsWith('/') ||
    ((creator === 3 || creator === 19) && ((attributes >>> 16) & 0o170000) === 0o040000) ||
    ((creator === 0 || creator === 11 || creator === 14) && (attributes & 0x10) !== 0)
  )
}

/** Walk a bounded central directory once, without reading local file data.
 * Upload and result inspection share structural checks but retain their own
 * name decoding, file selection, ZIP64 display and resource-limit policies.
 */
export function* zipDirectoryEntries(
  directory: DataView,
  count: number,
  invalid: (detail: string) => never = (detail) => {
    throw new Error(detail)
  },
) {
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directory.byteLength) invalid('Truncated ZIP directory entry.')
    if (directory.getUint32(cursor, true) !== 0x02014b50) invalid('Invalid ZIP directory entry.')
    const nameLength = directory.getUint16(cursor + 28, true)
    const extraLength = directory.getUint16(cursor + 30, true)
    const commentLength = directory.getUint16(cursor + 32, true)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > directory.byteLength) invalid('Truncated ZIP directory entry.')
    const start = directory.byteOffset + cursor
    if (
      !validDirectoryEntryZip64(
        new DataView(directory.buffer, start, 46),
        new DataView(directory.buffer, start + 46 + nameLength, extraLength),
      )
    ) {
      invalid('Invalid ZIP64 directory entry: missing or incomplete ZIP64 extra data.')
    }
    yield {
      offset: cursor,
      nameBytes: new Uint8Array(directory.buffer, start + 46, nameLength),
      creator: directory.getUint16(cursor + 4, true) >>> 8,
      flags: directory.getUint16(cursor + 8, true),
      size: directory.getUint32(cursor + 24, true),
      attributes: directory.getUint32(cursor + 38, true),
    }
    cursor = next
  }
  if (!validZipDirectoryEnd(directory, cursor))
    invalid('Unexpected ZIP directory contents: trailing data.')
}
