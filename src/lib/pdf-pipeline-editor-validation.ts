import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import {
  parseGotenbergVersion,
  requiresGotenberg91ForExtraction,
  requiresGotenberg92ForComposition,
} from '#/lib/gotenberg-version'
import { stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
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
            const { name, filename, field, embedded } = remote as Record<string, unknown>
            if (field || embedded) return []
            if (typeof filename === 'string' && filename !== '') return [filename]
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
    if (
      version &&
      requiresGotenberg92ForComposition(
        version,
        parsed.map(({ op }) => op),
      )
    ) {
      return 'PDF page composition requires Gotenberg 9.2 or newer.'
    }
    if (version?.major === 9 && version.minor < 2 && stagesUseGotenberg92PageSyntax(parsed)) {
      return 'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.'
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
