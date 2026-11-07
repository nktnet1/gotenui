import type { RemoteFile } from '#/lib/validation'
import { InputError } from '#/lib/validation'

/** Remote assets are named by Content-Disposition upstream, not the download URL.
 * The optional expected name is for preflight validation and asset selection only.
 */
export function remoteStageAssets(
  remotes: readonly RemoteFile[] = [],
  references: readonly string[],
  localNames: readonly string[] = [],
): string[] {
  const referenced = new Set(references.map((name) => name.normalize('NFC')))
  const known = new Set(localNames.map((name) => name.normalize('NFC').toLowerCase()))
  const assets: string[] = []
  for (const remote of remotes) {
    if (remote.field || remote.embedded) continue // Legacy v8 destinations are handled elsewhere.
    if (!remote.name) continue
    const key = remote.name.normalize('NFC').toLowerCase()
    if (known.has(key)) {
      throw new InputError(
        `Remote filename "${remote.name}" duplicates another file or expected download.`,
      )
    }
    known.add(key)
    if (referenced.has(remote.name.normalize('NFC'))) assets.push(remote.name.normalize('NFC'))
  }
  return assets
}
