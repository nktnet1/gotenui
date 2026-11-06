import { DEFAULT_MARKDOWN_NAME } from '#/lib/chromium-documents'
import { officeExtensionSetForMajor } from '#/lib/office-formats'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import { type ConversionPayload, InputError } from '#/lib/validation'
import type { Operation } from '#/tools/registry'

/** Inspect ZIP metadata, not file contents. Gotenberg remains responsible for
 * extracting entries, enforcing expansion limits and verifying file contents.
 */
const END_RECORD_BYTES = 22
const MAX_COMMENT_BYTES = 65_535
const MAX_DIRECTORY_BYTES = 512_000
const MAX_ENTRIES = 1_000
const decoder = new TextDecoder('utf-8', { fatal: false })

function invalidArchive(name: string, detail: string): never {
  throw new InputError(`ZIP archive ${name}: ${detail}`)
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
  if (end < 0) invalidArchive(archive.name, 'the ZIP central directory is missing.')
  const filesOnDisk = view.getUint16(end + 8, true)
  const count = view.getUint16(end + 10, true)
  const length = view.getUint32(end + 12, true)
  const offset = view.getUint32(end + 16, true)
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    filesOnDisk !== count ||
    count === 0xffff ||
    length === 0xffffffff ||
    offset === 0xffffffff
  ) {
    invalidArchive(archive.name, 'multi-volume or ZIP64 directories are not supported.')
  }
  if (count > MAX_ENTRIES || length > MAX_DIRECTORY_BYTES) {
    invalidArchive(archive.name, 'the ZIP index has too many entries or is too large.')
  }
  if (offset + length > tailStart + end) {
    invalidArchive(archive.name, 'the ZIP central directory is invalid.')
  }
  const bytes = new Uint8Array(await archive.slice(offset, offset + length).arrayBuffer())
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
    ...files.map(({ name }) => name.normalize('NFC').toLowerCase()),
    ...auxiliary.map(({ name }) => name.normalize('NFC').toLowerCase()),
    ...stageFiles.map(({ name }) => name.normalize('NFC').toLowerCase()),
  ])
  if (operation.input === 'html' || operation.input === 'markdown') {
    expected.add('index.html')
    expected.add('header.html')
    expected.add('footer.html')
    if (operation.input === 'markdown') {
      expected.add((payload.markdownName ?? DEFAULT_MARKDOWN_NAME).toLowerCase())
      for (const source of payload.markdownFiles ?? []) expected.add(source.name.toLowerCase())
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
  const extracted: string[] = []
  for (const archive of archives) {
    const prefix = new Uint8Array(await archive.slice(0, 4).arrayBuffer())
    if (
      prefix.length !== 4 ||
      prefix[0] !== 0x50 ||
      prefix[1] !== 0x4b ||
      !((prefix[2] === 0x03 && prefix[3] === 0x04) || (prefix[2] === 0x05 && prefix[3] === 0x06))
    ) {
      throw new InputError(`Archive ${archive.name} is not a ZIP file.`)
    }
    for (const name of await zipEntryNames(archive)) {
      // Gotenberg strips the path and NFC-normalises the filename it registers.
      const normalizedName = basename(name).normalize('NFC')
      const flatName = normalizedName.toLowerCase()
      const label = flatName.slice(0, 120)
      // Gotenberg resolves entries as named input files; compare basenames
      // case-insensitively, including across separate archives and uploads.
      if (expected.has(flatName)) {
        invalidArchive(archive.name, `duplicate or reserved filename: ${label}.`)
      }
      expected.add(flatName)
      extracted.push(normalizedName)
      const isStageAsset = stageAssets.has(normalizedName)
      if (operation.id === 'pdf-pipeline' && !flatName.endsWith('.pdf') && !isStageAsset) {
        invalidArchive(
          archive.name,
          `the PDF pipeline requires PDFs or referenced stage assets (found ${label}).`,
        )
      }
      if (operation.id === 'office-pdf') {
        const suffix = flatName.match(/\.[a-z0-9]+$/)?.[0] ?? ''
        if (!extensions.has(suffix) && !isStageAsset) {
          invalidArchive(archive.name, `unsupported Gotenberg 9 Office entry: ${label}.`)
        }
      }
    }
  }
  // Gotenberg treats PDFs/Documents consumed by stages as assets, not source
  // inputs. Catch asset-only archives before forwarding them upstream.
  if (
    (operation.id === 'pdf-pipeline' || operation.id === 'office-pdf') &&
    !files.length &&
    !payload.downloadFrom?.some((remote) => !remote.field && !remote.embedded) &&
    !extracted.some((name) => {
      if (stageAssets.has(name)) return false
      if (operation.id === 'pdf-pipeline') return name.toLowerCase().endsWith('.pdf')
      return extensions.has(name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '')
    })
  ) {
    throw new InputError(
      operation.id === 'pdf-pipeline'
        ? 'The PDF ZIP must contain at least one source PDF not reserved by a pipeline stage, or include a separate PDF input.'
        : 'The Office ZIP must contain at least one source document not reserved by a pipeline stage, or include a separate Office input.',
    )
  }
  return extracted
}
