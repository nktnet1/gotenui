import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import { parseGotenbergVersion, requiresGotenberg91ForExtraction } from '#/lib/gotenberg-version'
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
    backendVersion,
  }: {
    localAssetNames: readonly string[]
    archivesPresent: boolean
    remoteRows: readonly RemoteInputRow[]
    remoteJson: string
    acknowledgedRedaction: boolean
    backendVersion?: string
  },
): string | null {
  try {
    let assetNames: string[] | undefined
    let allowUnresolvedAssets = false
    if (!archivesPresent) {
      const remotes = remoteInputsPayload(remoteRows, remoteJson)
      const remoteAssetNames = Array.isArray(remotes)
        ? remotes.flatMap((remote: unknown) => {
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return []
            const { name, field, embedded } = remote as Record<string, unknown>
            if (field || embedded) return []
            if (typeof name === 'string' && name !== '') return [name]
            // Without a hint, Gotenberg resolves Content-Disposition at download time.
            allowUnresolvedAssets = true
            return []
          })
        : []
      assetNames = [...localAssetNames, ...remoteAssetNames]
    }
    const parsed = parsePdfPipeline(stages, {
      assetNames,
      allowUnresolvedAssets,
      acknowledgedRedaction,
    })
    const version = parseGotenbergVersion(backendVersion)
    if (
      version &&
      requiresGotenberg91ForExtraction(
        version,
        parsed.map(({ op }) => op),
      )
    ) {
      return 'PDF text and attachment extraction require Gotenberg 9.1 or newer.'
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
