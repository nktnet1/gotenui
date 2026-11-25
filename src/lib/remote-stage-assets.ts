import { effectiveRemoteFilename, filenameKey, registeredFilenames } from '#/lib/file-names'
import { type PdfPipelineStage, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import type { RemoteFile } from '#/lib/validation'
import { InputError } from '#/lib/validation'

/** Before 9.2, remote assets are named by Content-Disposition. In 9.2,
 * filename (or the editor's legacy name hint) overrides that header.
 * Gotenberg auto-numbers duplicate source document filenames, but a named stage
 * asset must remain unambiguous to resolve to the intended uploaded file.
 */
export function remoteStageAssets(
  remotes: readonly RemoteFile[] = [],
  references: readonly string[],
  localNames: readonly string[] = [],
  forwardedNames: readonly (string | undefined)[] = remotes.map(effectiveRemoteFilename),
): string[] {
  const referenced = new Set(references.map((name) => name.normalize('NFC')))
  const known = new Set(localNames.map(filenameKey))
  const assets: string[] = []
  for (const [index, remote] of remotes.entries()) {
    if (remote.field || remote.embedded) continue // Legacy v8 destinations are handled elsewhere.
    const name = forwardedNames[index]
    if (!name) continue
    const key = filenameKey(name)
    const isStageAsset = referenced.has(key)
    if (isStageAsset && known.has(key)) {
      throw new InputError(
        `Remote filename "${name}" duplicates another file or expected download.`,
      )
    }
    known.add(key)
    if (isStageAsset) assets.push(key)
  }
  return assets
}

/** Check stage and Chromium resource names after merge renaming.
 * Downloads register first, but Go iterates the upload and archive
 * fields in unspecified order. Neither possible order may shadow a named asset.
 * Unpinned remote names remain unknown until Gotenberg downloads the files.
 */
export function validateAssetFilenameRegistration(
  form: FormData,
  archiveEntryNames: readonly string[],
  chromium: boolean,
): void {
  const rawStages = form.get('stages')
  const stages = typeof rawStages === 'string' ? (JSON.parse(rawStages) as PdfPipelineStage[]) : []
  const protectedNames = new Set(pdfStageAssetNames(stages).map(filenameKey))
  if (!protectedNames.size && !chromium) return
  const remotes = JSON.parse(String(form.get('downloadFrom') ?? '[]')) as RemoteFile[]
  const remoteNames = remotes.flatMap(({ filename }) => (filename ? [filename] : []))
  const uploads = form
    .getAll('files')
    .flatMap((entry) => (entry instanceof File ? [entry.name] : []))
  const orders = [
    [...remoteNames, ...uploads, ...archiveEntryNames],
    [...remoteNames, ...archiveEntryNames, ...uploads],
  ]
  for (const order of orders) {
    const assigned = registeredFilenames(order)
    // Chromium resolves every resource by its workspace filename. A repeated
    // basename may legitimately acquire a suffix, but must not take a name
    // supplied explicitly for a different resource.
    const owners = new Map<string, string>()
    for (const [index, raw] of order.entries()) {
      const name = filenameKey(raw)
      if (protectedNames.has(name) && assigned[index] !== name) {
        throw new InputError(
          `Stage asset filename collides after Gotenberg numbers duplicate files: ${name}. Rename the asset or the colliding input.`,
        )
      }
      if (chromium && owners.has(name) && owners.get(name) !== name) {
        throw new InputError(
          `Chromium asset filename collides after Gotenberg numbers duplicate files: ${name}. Rename the asset or the colliding input.`,
        )
      }
      owners.set(assigned[index] as string, name)
    }
  }
}
