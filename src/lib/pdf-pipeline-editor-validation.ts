import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import { planRemoteFilenames } from '#/lib/file-names'
import {
  parseGotenbergVersion,
  requiresGotenberg91ForExtraction,
  requiresGotenberg92ForComposition,
  requiresGotenberg94ForStampPosition,
  requiresGotenberg95ForPaperSize,
  requiresGotenberg96ForSignatureDrop,
  requiresGotenberg97ForFileBookmarks,
  requiresGotenberg98ForExtractTextFormat,
  requiresGotenberg99ForCompressStreams,
} from '#/lib/gotenberg-version'
import {
  mergeUploadFilenames,
  numbersPipelineInputs,
  remoteMergeFilenames,
} from '#/lib/merge-order'
import { OFFICE_V9_EXTENSION_SET } from '#/lib/office-formats'
import { reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import { stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import { parsePdfPipeline, pdfStageAssetNames, validatePdfStageUploads } from '#/lib/pdf-pipeline'

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
    const conversionMode = documentKind === 'office' || documentKind === 'single'
    const parsed = parsePdfPipeline(stages, {
      assetNames,
      allowUnresolvedAssets,
      allowEmpty: conversionMode,
      acknowledgedRedaction,
    })
    validatePdfStageUploads(parsed, localAssetNames, conversionMode)
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
    if (
      version &&
      requiresGotenberg95ForPaperSize(
        version,
        parsed.filter(({ op }) => op === 'compose').map(({ paperSize }) => paperSize),
      )
    ) {
      return 'A0, A1 and A2 paper sizes require Gotenberg 9.5 or newer.'
    }
    if (version && requiresGotenberg96ForSignatureDrop(version, parsed)) {
      return 'Removing digital signatures requires Gotenberg 9.6 or newer.'
    }
    if (version && requiresGotenberg97ForFileBookmarks(version, parsed)) {
      return 'Per-file merge bookmarks require Gotenberg 9.7 or newer.'
    }
    if (version && requiresGotenberg98ForExtractTextFormat(version, parsed)) {
      return 'Extraction formats require Gotenberg 9.8 or newer.'
    }
    if (version && requiresGotenberg99ForCompressStreams(version, parsed)) {
      return 'PDF stream compression control requires Gotenberg 9.9 or newer.'
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
      const sourceRemotes = Array.isArray(remotes)
        ? remotes.flatMap((remote: unknown) => {
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return []
            const { url, filename, name, field, embedded } = remote as Record<string, unknown>
            if (field || embedded) return []
            return [
              {
                url: typeof url === 'string' ? url : '',
                name: typeof name === 'string' ? name : undefined,
                filename: typeof filename === 'string' ? filename : undefined,
              },
            ]
          })
        : []
      const localNames = documentNames ?? []
      const remoteFilenames = planRemoteFilenames(sourceRemotes, {
        supportsFilename: version?.major === 9 && version.minor >= 2,
        inferAll: localNames.length > 0,
        pinAll: localAssetNames.length > 0,
        stageAssetNames: referencedAssets,
      }).map(({ name }) => name)
      const remoteSources = remoteFilenames.filter(
        (name): name is string => name !== undefined && extensionMatches(name),
      )
      const unknownRemote = documentKind !== 'single' && remoteFilenames.some((name) => !name)
      const pipeline = [...(builtInMerge ? ([{ op: 'merge' }] as const) : []), ...parsed]
      const forwarded = numbersPipelineInputs(pipeline, localNames.length, builtInMerge)
        ? mergeUploadFilenames(localNames, [
            ...remoteMergeFilenames(sourceRemotes),
            ...localAssetNames,
          ])
        : localNames
      const pdfName = (name: string) => (documentKind === 'office' ? `${name}.pdf` : name)
      const sources =
        documentKind === 'single'
          ? outputName
            ? [{ original: `${outputName}.pdf`, forwarded: `${outputName}.pdf` }]
            : []
          : [
              ...localNames.map((name, index) => ({
                original: pdfName(name),
                forwarded: pdfName(forwarded[index] ?? name),
              })),
              ...remoteSources.map((name) => ({
                original: pdfName(name),
                forwarded: pdfName(name),
              })),
            ]
      if (sources.length || unknownRemote || documentKind === 'single') {
        reconcilePdfComposeSources(pipeline, {
          inputs: sources,
          singleInput: documentKind === 'single',
          unknownInputs: unknownRemote,
        })
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
