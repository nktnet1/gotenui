import { generatedChromiumFilenames } from '#/lib/chromium-documents'
import {
  decodeFilenameBytes,
  effectiveRemoteFilename,
  filenameKey,
  possibleRemoteFilename,
  registeredFilenames,
} from '#/lib/file-names'
import { officeExtensionSetForMajor } from '#/lib/office-formats'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import { type ConversionPayload, InputError } from '#/lib/validation'
import {
  findZipEndRecord,
  hasZipDirectoryHeaderAt,
  ZIP_END_SEARCH_BYTES,
  zipDirectoryEntries,
  zipEntryIsDirectory,
} from '#/lib/zip-directory'
import type { Operation } from '#/tools/registry'

/** Inspect ZIP metadata, not file contents. Gotenberg remains responsible for
 * extracting entries, enforcing expansion limits and verifying file contents.
 */
// Keep the in-browser ZIP metadata inspection bounded; Gotenberg enforces
// the actual extraction quota (10,000 entries by default) and body limit.
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 10_000

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
export async function zipEntryNames(archive: File): Promise<string[]> {
  const tailStart = Math.max(0, archive.size - ZIP_END_SEARCH_BYTES)
  const tail = new Uint8Array(await archive.slice(tailStart).arrayBuffer())
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const end = findZipEndRecord(view)
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
  // The locator can fall before the bounded tail read when a long comment
  // or trailer follows the end record. Read its 20 bytes separately.
  const needsZip64 = count === 0xffff || length === 0xffffffff || offset === 0xffffffff
  const locatorBytes =
    locatorAt >= 0
      ? tail.subarray(locatorAt, end)
      : needsZip64 && endOffset >= 20
        ? new Uint8Array(await archive.slice(endOffset - 20, endOffset).arrayBuffer())
        : new Uint8Array(0)
  const locator = new DataView(
    locatorBytes.buffer,
    locatorBytes.byteOffset,
    locatorBytes.byteLength,
  )
  const zip64 =
    needsZip64 && locatorBytes.length === 20 && locator.getUint32(0, true) === 0x07064b50
  let directoryEnd = endOffset
  if (zip64) {
    if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) {
      invalidArchive(archive.name, 'multi-volume ZIP64 archives are not supported.')
    }
    // Unlike the classic directory offset, Go reads the ZIP64 end record
    // at the locator's declared position. Do not invent another record offset.
    const zip64Offset = safeZip64Integer(locator.getBigUint64(8, true), archive.name)
    const beforeLocator = endOffset - 20
    const recordBytes = new Uint8Array(
      await archive.slice(zip64Offset, zip64Offset + 56).arrayBuffer(),
    )
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
  const directoryOffset =
    baseOffset > 0 && (await hasZipDirectoryHeaderAt(archive, offset))
      ? offset
      : offset + baseOffset
  const bytes = new Uint8Array(
    await archive.slice(directoryOffset, directoryOffset + length).arrayBuffer(),
  )
  if (bytes.byteLength !== length) invalidArchive(archive.name, 'the ZIP index is incomplete.')
  const directory = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  for (const entry of zipDirectoryEntries(directory, count, (detail) =>
    invalidArchive(archive.name, detail),
  )) {
    const name = decodeFilenameBytes(entry.nameBytes)
    // Gotenberg skips anything for which Go archive/zip's Mode().IsRegular()
    // is false. Unix and macOS creators use Unix file types, while FAT, NTFS
    // and VFAT creators use the DOS directory attribute, even when the entry
    // name has no trailing slash.
    const { creator, attributes: externalAttributes, flags } = entry
    const unixType = (externalAttributes >>> 16) & 0o170000
    const unixNonRegular =
      (creator === 3 || creator === 19) &&
      [0o010000, 0o020000, 0o060000, 0o120000, 0o140000].includes(unixType)
    if (
      zipEntryIsDirectory(creator, externalAttributes, name) ||
      name.endsWith('\\') ||
      unixNonRegular ||
      ignoredArchiveEntry(name)
    ) {
      continue
    }
    if (flags & 1) {
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
  }
  // An empty archive (or one containing only skipped directory/metadata
  // entries) is valid in Gotenberg when other request inputs are provided.
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
  const localSources = new Set(files.map(({ name }) => filenameKey(name)))
  const protectedNames = new Set<string>([
    ...auxiliary.map(({ name }) => filenameKey(name)),
    ...stageFiles.map(({ name }) => filenameKey(name)),
  ])
  const expected = new Set<string>([...localSources, ...protectedNames])
  for (const name of generatedChromiumFilenames(operation.input, payload)) {
    expected.add(filenameKey(name))
    protectedNames.add(filenameKey(name))
  }
  const remoteNames = new Set(
    registeredFilenames(
      (payload.downloadFrom ?? []).flatMap((remote) => {
        const name = possibleRemoteFilename(remote)
        return name ? [name] : []
      }),
    ),
  )
  const extensions = officeExtensionSetForMajor(9)
  const stages =
    operation.id === 'pdf-pipeline'
      ? parsePdfPipeline(String(payload.fields.stages ?? ''), {
          acknowledgedRedaction: payload.fields.acknowledgedRedaction === true,
        })
      : payload.conversionStages
        ? parsePdfPipeline(payload.conversionStages, {
            allowEmpty: true,
            acknowledgedRedaction: payload.acknowledgedConversionRedaction,
          })
        : []
  const stageAssets = new Set(pdfStageAssetNames(stages))
  const remoteAssets = (payload.downloadFrom ?? []).filter((remote) => {
    const name = effectiveRemoteFilename(remote)
    return (
      !remote.embedded &&
      !remote.field &&
      name !== undefined &&
      stageAssets.has(name.normalize('NFC'))
    )
  })
  const remoteSources = (payload.downloadFrom ?? []).filter(
    (remote) => !remote.field && !remote.embedded && !remoteAssets.includes(remote),
  )
  const extracted: string[] = []
  const archiveSources = new Set<string>()
  const archiveExtras = new Set<string>()
  for (const archive of archives) {
    for (const name of await zipEntryNames(archive)) {
      // Gotenberg strips the path and NFC-normalises the filename it registers.
      const normalizedName = basename(name).normalize('NFC')
      const flatName = filenameKey(normalizedName)
      const label = normalizedName.slice(0, 120)
      // A remote file can claim an archive entry's name before ZIP extraction.
      // Protect all Chromium resources and named PDF-stage assets, but keep
      // duplicate PDF/Office source documents eligible for auto-numbering.
      const isStageAsset = stageAssets.has(normalizedName)
      if (
        remoteNames.has(flatName) &&
        (operation.path.startsWith('/forms/chromium/') || isStageAsset)
      ) {
        invalidArchive(archive.name, `filename collides with a remote asset: ${label}.`)
      }
      // Gotenberg resolves entries as named input files; compare basenames
      // by exact NFC spelling, including across separate archives and uploads.
      const suffix = flatName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
      const isSourceDocument =
        !isStageAsset &&
        ((operation.input === 'pdf' && suffix === '.pdf') ||
          (operation.id === 'office-pdf' && extensions.has(suffix)))
      // Gotenberg's uniqueFilename registers colliding source documents as
      // "name (2).pdf", "name (3).pdf", etc. The same applies inside ZIPs.
      // Do not accept ambiguous collisions involving named stage assets or
      // generated Chromium documents, since those are referenced by name.
      const duplicateSource =
        isSourceDocument &&
        !protectedNames.has(flatName) &&
        (localSources.has(flatName) || archiveSources.has(flatName))
      // Unrelated archive files are also auto-renamed upstream. Repeated
      // resources must not displace explicitly named pipeline assets.
      const duplicateExtra =
        !isSourceDocument &&
        !isStageAsset &&
        !protectedNames.has(flatName) &&
        archiveExtras.has(flatName)
      if (expected.has(flatName) && !duplicateSource && !duplicateExtra) {
        invalidArchive(archive.name, `duplicate or reserved filename: ${label}.`)
      }
      expected.add(flatName)
      extracted.push(normalizedName)
      if (isSourceDocument) archiveSources.add(flatName)
      else if (!isStageAsset) archiveExtras.add(flatName)
      // Non-source entries are allowed. Gotenberg extracts them but only
      // selects documents of the appropriate type for conversion; other files
      // may still be referenced by an explicit pipeline stage.
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
    // Gotenberg 9 can merge a single valid PDF without rewriting its bytes.
    const required = 1
    if (available < required) {
      throw new InputError(
        `Upload at least ${required} PDF input${required > 1 ? 's' : ''}, including PDFs inside ZIP archives.`,
      )
    }
  }
  return extracted
}
