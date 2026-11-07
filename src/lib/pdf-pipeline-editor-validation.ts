import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'

/** Preflight the same asset names as the request adapter, including remote
 * filename hints. Gotenberg still verifies the actual downloaded filenames.
 */
export function pdfPipelineEditorError(
  stages: string,
  {
    localAssetNames,
    archivesPresent,
    remoteRows,
    remoteJson,
    acknowledgedRedaction,
  }: {
    localAssetNames: readonly string[]
    archivesPresent: boolean
    remoteRows: readonly RemoteInputRow[]
    remoteJson: string
    acknowledgedRedaction: boolean
  },
): string | null {
  try {
    let assetNames: string[] | undefined
    if (!archivesPresent) {
      const remotes = remoteInputsPayload(remoteRows, remoteJson)
      const remoteAssetNames = Array.isArray(remotes)
        ? remotes.flatMap((remote: unknown) => {
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return []
            const { name, field, embedded } = remote as Record<string, unknown>
            return typeof name === 'string' && name !== '' && !field && !embedded ? [name] : []
          })
        : []
      assetNames = [...localAssetNames, ...remoteAssetNames]
    }
    parsePdfPipeline(stages, { assetNames, acknowledgedRedaction })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
