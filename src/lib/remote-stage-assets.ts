import { filenameKey } from '#/lib/file-names'
import type { RemoteFile } from '#/lib/validation'
import { InputError } from '#/lib/validation'

/** Remote assets are named by Content-Disposition upstream, not the download URL.
 * The optional expected name is for preflight validation and asset selection only.
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
    if (!remote.name) continue
    const key = filenameKey(remote.name)
    const isStageAsset = referenced.has(key)
    if (isStageAsset && known.has(key)) {
      throw new InputError(
        `Remote filename "${remote.name}" duplicates another file or expected download.`,
      )
    }
    known.add(key)
    if (isStageAsset) assets.push(key)
  }
  return assets
}
