import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import {
  parseGotenbergVersion,
  requiresGotenberg91ForExtraction,
  requiresGotenberg92ForComposition,
  requiresGotenberg94ForStampPosition,
} from '#/lib/gotenberg-version'
import { OFFICE_V9_EXTENSION_SET } from '#/lib/office-formats'
import { reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import { stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'

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
    documentNames,
    documentKind,
    builtInMerge,
    outputName,
  }: {
    localAssetNames: readonly string[]
    archivesPresent: boolean
    remoteRows: readonly RemoteInputRow[]
    remoteJson: string
    acknowledgedRedaction: boolean
    backendVersion?: string
    /** Source uploads, as opposed to separately uploaded stage assets. */
    documentNames?: readonly string[]
    documentKind?: 'office' | 'pdf' | 'single'
    builtInMerge?: boolean
    /** The optional Gotenberg-Output-Filename basename for Chromium conversions. */
    outputName?: string
  },
): string | null {
  try {
    let assetNames: string[] | undefined
    let allowUnresolvedAssets = false
    let remotes: unknown
    if (!archivesPresent) {
      remotes = remoteInputsPayload(remoteRows, remoteJson)
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
      allowEmpty: documentKind === 'office' || documentKind === 'single',
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
    if (version && requiresGotenberg94ForStampPosition(version, parsed)) {
      return 'Anchored PDF stamps require Gotenberg 9.4 or newer.'
    }
    if (version?.major === 9 && version.minor < 2 && stagesUseGotenberg92PageSyntax(parsed)) {
      return 'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.'
    }
    if (documentKind && !archivesPresent) {
      const referencedAssets = new Set(pdfStageAssetNames(parsed))
      const extensionMatches = (name: string): boolean =>
        !referencedAssets.has(name.normalize('NFC')) &&
        (documentKind === 'office'
          ? OFFICE_V9_EXTENSION_SET.has(name.slice(name.lastIndexOf('.')).toLowerCase())
          : documentKind === 'pdf' && /\.pdf$/i.test(name))
      const remoteSources = Array.isArray(remotes)
        ? remotes.flatMap((remote: unknown) => {
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return []
            const { filename, name, field, embedded } = remote as Record<string, unknown>
            if (field || embedded) return []
            const known = typeof filename === 'string' && filename ? filename : name
            return typeof known === 'string' && extensionMatches(known) ? [known] : []
          })
        : []
      const unknownRemote =
        documentKind !== 'single' &&
        Array.isArray(remotes) &&
        remotes.some((remote: unknown) => {
          if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false
          const { filename, name, field, embedded } = remote as Record<string, unknown>
          return !field && !embedded && !filename && !name
        })
      const sourceNames =
        documentKind === 'single'
          ? outputName
            ? [`${outputName}.pdf`]
            : []
          : [...(documentNames ?? []), ...remoteSources]
      if (sourceNames.length || unknownRemote || documentKind === 'single') {
        const sources = sourceNames.map((name) => {
          const pdfName = documentKind === 'office' ? `${name}.pdf` : name
          return { original: pdfName, forwarded: pdfName }
        })
        reconcilePdfComposeSources(
          [...(builtInMerge ? ([{ op: 'merge' }] as const) : []), ...parsed],
          {
            inputs: sources,
            singleInput: documentKind === 'single',
            unknownInputs: unknownRemote,
          },
        )
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
