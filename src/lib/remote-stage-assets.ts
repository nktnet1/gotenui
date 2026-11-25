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
): string[] {
  const referenced = new Set(references.map((name) => name.normalize('NFC')))
  const known = new Set(localNames.map(filenameKey))
  const assets: string[] = []
  for (const remote of remotes) {
    if (remote.field || remote.embedded) continue // Legacy v8 destinations are handled elsewhere.
    const name = effectiveRemoteFilename(remote)
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

/** Check exact stage references against the final multipart names, after merge
 * renaming. Downloads register first, but Go iterates the upload and archive
 * fields in unspecified order. Neither possible order may shadow a named asset.
 * Unpinned remote names remain unknown until Gotenberg downloads the files.
 */
export function validateStageFilenameRegistration(
  form: FormData,
  archiveEntryNames: readonly string[],
): void {
  const rawStages = form.get('stages')
  if (typeof rawStages !== 'string') return
  const stages = JSON.parse(rawStages) as PdfPipelineStage[]
  const protectedNames = new Set(pdfStageAssetNames(stages).map(filenameKey))
  if (!protectedNames.size) return
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
    for (const [index, raw] of order.entries()) {
      const name = filenameKey(raw)
      if (protectedNames.has(name) && assigned[index] !== name) {
        throw new InputError(
          `Stage asset filename collides after Gotenberg numbers duplicate files: ${name}. Rename the asset or the colliding input.`,
        )
      }
    }
  }
}
