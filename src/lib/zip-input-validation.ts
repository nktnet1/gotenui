import { DEFAULT_MARKDOWN_NAME } from '#/lib/chromium-documents'
import { filenameKey } from '#/lib/file-names'
import { officeExtensionSetForMajor } from '#/lib/office-formats'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import { type ConversionPayload, InputError } from '#/lib/validation'
import type { Operation } from '#/tools/registry'

/** Inspect ZIP metadata, not file contents. Gotenberg remains responsible for
 * extracting entries, enforcing expansion limits and verifying file contents.
 */
const END_RECORD_BYTES = 22
const MAX_COMMENT_BYTES = 65_535
// Keep the in-browser ZIP metadata inspection bounded; Gotenberg enforces
// the actual extraction quota (10,000 entries by default) and body limit.
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 10_000
const decoder = new TextDecoder('utf-8', { fatal: false })

function invalidArchive(name: string, detail: string): never {
  throw new InputError(`ZIP archive ${name}: ${detail}`)
}

function safeZip64Integer(value: bigint, archiveName: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalidArchive(archiveName, 'the ZIP64 index is too large to inspect safely.')
  }
  return Number(value)
}

function basename(name: string): string {
  return name.split(/[\\/]/).at(-1) ?? name
}

/** Mirror Gotenberg's archive extractor, which skips AppleDouble resources. */
function ignoredArchiveEntry(name: string): boolean {
  // Go's filepath.Base on Linux interprets '/' only; match its exact skip
  // policy rather than ignoring a backslash-path entry upstream will extract.
  return name.startsWith('__MACOSX/') || name.split('/').at(-1)?.startsWith('._') === true
}

/** Read a bounded central directory, including names past the first 30 entries. */
async function zipEntryNames(archive: File): Promise<string[]> {
  const tailStart = Math.max(0, archive.size - END_RECORD_BYTES - MAX_COMMENT_BYTES)
  const tail = new Uint8Array(await archive.slice(tailStart).arrayBuffer())
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let end = -1
  for (let offset = tail.length - END_RECORD_BYTES; offset >= 0; offset--) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + END_RECORD_BYTES + view.getUint16(offset + 20, true) === tail.length
    ) {
      end = offset
      break
    }
  }
  if (end < 0)
    invalidArchive(archive.name, 'is not a ZIP file: the ZIP central directory is missing.')
  const filesOnDisk = view.getUint16(end + 8, true)
  let count = view.getUint16(end + 10, true)
  let length = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    invalidArchive(archive.name, 'multi-volume ZIP archives are not supported.')
  }
  const endOffset = tailStart + end
  // ZIP64 extends the classic EOCD with a locator and a 64-bit end record.
  // Read only its fixed header, then the bounded central directory itself.
  const locatorAt = end - 20
  const zip64 = locatorAt >= 0 && view.getUint32(locatorAt, true) === 0x07064b50
  let directoryEnd = endOffset
  if (zip64) {
    if (view.getUint32(locatorAt + 4, true) !== 0 || view.getUint32(locatorAt + 16, true) !== 1) {
      invalidArchive(archive.name, 'multi-volume ZIP64 archives are not supported.')
    }
    // ZIP64 locator offsets may be relative to an executable preamble, just
    // like the ordinary central-directory offset. For the standard fixed-size
    // end record, its physical location is immediately before the locator.
    const declaredOffset = safeZip64Integer(view.getBigUint64(locatorAt + 8, true), archive.name)
    const beforeLocator = endOffset - 20
    let zip64Offset = declaredOffset
    let recordBytes = new Uint8Array(
      await archive.slice(zip64Offset, zip64Offset + 56).arrayBuffer(),
    )
    if (
      (recordBytes.length !== 56 ||
        new DataView(recordBytes.buffer).getUint32(0, true) !== 0x06064b50) &&
      beforeLocator >= 56 &&
      declaredOffset !== beforeLocator - 56
    ) {
      zip64Offset = beforeLocator - 56
      recordBytes = new Uint8Array(await archive.slice(zip64Offset, zip64Offset + 56).arrayBuffer())
    }
    if (recordBytes.length !== 56 || zip64Offset + 56 > beforeLocator) {
      invalidArchive(archive.name, 'the ZIP64 end record is invalid.')
    }
    const record = new DataView(recordBytes.buffer, recordBytes.byteOffset, recordBytes.byteLength)
    if (
      record.getUint32(0, true) !== 0x06064b50 ||
      record.getBigUint64(4, true) < 44n ||
      record.getUint32(16, true) !== 0 ||
      record.getUint32(20, true) !== 0 ||
      record.getBigUint64(24, true) !== record.getBigUint64(32, true)
    ) {
      invalidArchive(archive.name, 'the ZIP64 end record is invalid.')
    }
    directoryEnd = zip64Offset
    const recordSize = safeZip64Integer(record.getBigUint64(4, true), archive.name)
    if (zip64Offset + 12 + recordSize !== endOffset - 20) {
      invalidArchive(archive.name, 'the ZIP64 end record length is invalid.')
    }
    count = safeZip64Integer(record.getBigUint64(32, true), archive.name)
    length = safeZip64Integer(record.getBigUint64(40, true), archive.name)
    offset = safeZip64Integer(record.getBigUint64(48, true), archive.name)
    if (
      (filesOnDisk !== 0xffff && filesOnDisk !== count) ||
      (view.getUint16(end + 10, true) !== 0xffff && view.getUint16(end + 10, true) !== count)
    ) {
      invalidArchive(archive.name, 'the ZIP64 entry count disagrees with the ZIP directory.')
    }
  } else if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    invalidArchive(archive.name, 'the ZIP64 locator is missing.')
  } else if (filesOnDisk !== count) {
    invalidArchive(archive.name, 'multi-volume ZIP archives are not supported.')
  }
  if (count > MAX_ENTRIES || length > MAX_DIRECTORY_BYTES) {
    invalidArchive(archive.name, 'the ZIP index has too many entries or is too large.')
  }
  // Go's archive/zip supports a ZIP appended to another file (e.g. an SFX
  // archive). Its directory offsets can be relative to that prefix. Compute
  // the same nonnegative base offset rather than assuming the archive starts
  // with PK at byte zero. Still reject overlaps and out-of-bounds indexes.
  const baseOffset = directoryEnd - offset - length
  if (baseOffset < 0 || directoryEnd > archive.size || directoryEnd < length) {
    invalidArchive(archive.name, 'the ZIP central directory is invalid.')
  }
  const directoryOffset = offset + baseOffset
  const bytes = new Uint8Array(
    await archive.slice(directoryOffset, directoryOffset + length).arrayBuffer(),
  )
  if (bytes.byteLength !== length) invalidArchive(archive.name, 'the ZIP index is incomplete.')
  const directory = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > length || directory.getUint32(cursor, true) !== 0x02014b50) {
      invalidArchive(archive.name, 'the ZIP index contains an invalid entry.')
    }
    const nameLength = directory.getUint16(cursor + 28, true)
    const extraLength = directory.getUint16(cursor + 30, true)
    const commentLength = directory.getUint16(cursor + 32, true)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > length) invalidArchive(archive.name, 'the ZIP index contains a truncated entry.')
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    // Gotenberg ignores directories, Unix symlinks and macOS resource forks.
    // Do not let skipped entries shadow or constrain actual uploaded files.
    const unixMode = directory.getUint32(cursor + 38, true) >>> 16
    const unixType = unixMode & 0o170000
    const unixNonRegular =
      directory.getUint16(cursor + 4, true) >>> 8 === 3 && unixType !== 0 && unixType !== 0o100000
    if (name.endsWith('/') || name.endsWith('\\') || unixNonRegular || ignoredArchiveEntry(name)) {
      cursor = next
      continue
    }
    if (directory.getUint16(cursor + 8, true) & 1) {
      invalidArchive(archive.name, 'encrypted ZIP entries are not supported.')
    }
    if (
      !name ||
      Array.from(name).some((character) => {
        const point = character.codePointAt(0) ?? 0
        return point < 32 || point === 127
      })
    ) {
      invalidArchive(archive.name, 'an entry has an invalid filename.')
    }
    // Reject ambiguous paths before Gotenberg is asked to extract them. Ordinary
    // subdirectories and their filenames are allowed.
    const segments = name.replaceAll('\\', '/').split('/')
    if (
      name.startsWith('/') ||
      name.startsWith('\\') ||
      /^[a-z]:/i.test(name) ||
      segments.some((part) => part === '..')
    ) {
      invalidArchive(archive.name, 'entry paths must remain inside the ZIP.')
    }
    names.push(name)
    cursor = next
  }
  if (cursor !== length) invalidArchive(archive.name, 'the ZIP index has trailing data.')
  if (!names.length) invalidArchive(archive.name, 'include at least one file in the ZIP.')
  return names
}

/** Validate what an uploaded ZIP claims to contain before forwarding to Gotenberg 9.
 * Do not decompress, trust file extensions as signatures or guess remote names.
 * Return the effective names for downstream stage-reference validation.
 */
export async function validateZipInputs(
  operation: Operation,
  payload: ConversionPayload,
  files: readonly File[],
  auxiliary: readonly File[],
  stageFiles: readonly File[],
  archives: readonly File[],
): Promise<string[]> {
  if (!archives.length) return []
  const expected = new Set<string>([
    ...files.map(({ name }) => filenameKey(name)),
    ...auxiliary.map(({ name }) => filenameKey(name)),
    ...stageFiles.map(({ name }) => filenameKey(name)),
  ])
  if (operation.input === 'html' || operation.input === 'markdown') {
    expected.add('index.html')
    expected.add('header.html')
    expected.add('footer.html')
    if (operation.input === 'markdown') {
      expected.add(filenameKey(payload.markdownName ?? DEFAULT_MARKDOWN_NAME))
      for (const source of payload.markdownFiles ?? []) expected.add(filenameKey(source.name))
    }
  }
  const extensions = officeExtensionSetForMajor(9)
  const stages =
    operation.id === 'pdf-pipeline'
      ? parsePdfPipeline(String(payload.fields.stages ?? ''), {
          acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
        })
      : payload.conversionStages
        ? parsePdfPipeline(payload.conversionStages, {
            acknowledgedRedaction: payload.acknowledgedConversionRedaction,
          })
        : []
  const stageAssets = new Set(pdfStageAssetNames(stages))
  const remoteAssets = (payload.downloadFrom ?? []).filter(
    (remote) => remote.name !== undefined && stageAssets.has(remote.name.normalize('NFC')),
  )
  const remoteSources = (payload.downloadFrom ?? []).filter(
    (remote) => !remote.field && !remote.embedded && !remoteAssets.includes(remote),
  )
  const extracted: string[] = []
  for (const archive of archives) {
    for (const name of await zipEntryNames(archive)) {
      // Gotenberg strips the path and NFC-normalises the filename it registers.
      const normalizedName = basename(name).normalize('NFC')
      const flatName = filenameKey(normalizedName)
      const label = normalizedName.slice(0, 120)
      // Gotenberg resolves entries as named input files; compare basenames
      // by exact NFC spelling, including across separate archives and uploads.
      if (expected.has(flatName)) {
        invalidArchive(archive.name, `duplicate or reserved filename: ${label}.`)
      }
      expected.add(flatName)
      extracted.push(normalizedName)
      const isStageAsset = stageAssets.has(normalizedName)
      if (operation.input === 'pdf' && !flatName.toLowerCase().endsWith('.pdf') && !isStageAsset) {
        invalidArchive(
          archive.name,
          `${operation.id === 'pdf-pipeline' ? 'PDF pipeline requires PDFs or referenced stage assets' : 'PDF tools require PDFs or referenced pipeline stage assets'} (found ${label}).`,
        )
      }
      if (operation.id === 'office-pdf') {
        const suffix = flatName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
        if (!extensions.has(suffix) && !isStageAsset) {
          invalidArchive(archive.name, `unsupported Gotenberg 9 Office entry: ${label}.`)
        }
      }
    }
  }
  // Gotenberg treats PDFs/Documents consumed by stages as assets, not source
  // inputs. Catch asset-only archives before forwarding them upstream.
  if (
    (operation.input === 'pdf' || operation.id === 'office-pdf') &&
    !files.length &&
    remoteSources.length === 0 &&
    !extracted.some((name) => {
      if (stageAssets.has(name)) return false
      if (operation.input === 'pdf') return name.toLowerCase().endsWith('.pdf')
      return extensions.has(name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '')
    })
  ) {
    throw new InputError(
      operation.input === 'pdf'
        ? 'The PDF ZIP must contain at least one source PDF not reserved by a pipeline stage, or include a separate PDF input.'
        : 'The Office ZIP must contain at least one source document not reserved by a pipeline stage, or include a separate Office input.',
    )
  }
  if (operation.input === 'pdf') {
    const available =
      files.length +
      remoteSources.length +
      extracted.filter((name) => name.toLowerCase().endsWith('.pdf') && !stageAssets.has(name))
        .length
    const required = operation.id === 'merge' ? 2 : 1
    if (available < required) {
      throw new InputError(
        `Upload at least ${required} PDF input${required > 1 ? 's' : ''}, including PDFs inside ZIP archives.`,
      )
    }
  }
  return extracted
}
