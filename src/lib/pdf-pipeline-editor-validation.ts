import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import {
  CHROMIUM_REMOTE_FILENAME_VERSION_REASON,
  planRemoteFilenames,
  remoteFilenamePlanReason,
} from '#/lib/file-names'
import { planV9ConversionStages } from '#/lib/gotenberg-conversion-adapter'
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
import { officePdfComposeInput, reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import { stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import {
  parsePdfPipeline,
  pdfStageAssetNames,
  validatePdfStageUploads,
  validatePipelineSourceUploads,
} from '#/lib/pdf-pipeline'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { isV9SourceDocument, sourceDocumentReason } from '#/lib/source-documents'
import { type ConversionPayload, parseAdvanced, validateAsyncInputValues } from '#/lib/validation'

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
    splitMode,
    splitSpan,
    splitUnify,
    outputName,
    conversionFields,
    advancedJson,
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
    splitMode?: string
    splitSpan?: string
    splitUnify?: boolean
    /** The optional Gotenberg-Output-Filename basename for Chromium conversions. */
    outputName?: string
    conversionFields?: ConversionPayload['fields']
    advancedJson?: string
  },
): string | null {
  try {
    const conversionMode = documentKind === 'office' || documentKind === 'single'
    const parsed = parsePdfPipeline(stages, { allowEmpty: conversionMode, acknowledgedRedaction })
    const version = parseGotenbergVersion(backendVersion)
    const localNames = documentNames ?? []
    const referencedAssets = new Set(pdfStageAssetNames(parsed))
    const remotes =
      validateAsyncInputValues(remoteInputsPayload(remoteRows, remoteJson), undefined)
        .downloadFrom ?? []
    const sourceRemotes = remotes.filter(({ field, embedded }) => !field && !embedded)
    if (
      documentKind === 'single' &&
      sourceRemotes.length &&
      version?.major === 9 &&
      version.minor < 2
    ) {
      return CHROMIUM_REMOTE_FILENAME_VERSION_REASON
    }
    const filenamePlan = planRemoteFilenames(sourceRemotes, {
      supportsFilename: version?.major === 9 && version.minor >= 2,
      inferAll: localNames.length > 0 || archivesPresent,
      pinAll: localAssetNames.length > 0 || documentKind === 'single',
      stageAssetNames: referencedAssets,
    })
    const filenameReason = remoteFilenamePlanReason(filenamePlan)
    if (filenameReason) return filenameReason
    const remoteFilenames = filenamePlan.map(({ name }) => name)
    if (
      (documentKind === 'pdf' || documentKind === 'office') &&
      version?.major === 9 &&
      version.minor >= 2 &&
      !archivesPresent &&
      (localNames.length || sourceRemotes.length)
    ) {
      const reason = sourceDocumentReason(
        documentKind,
        [...localNames, ...remoteFilenames],
        referencedAssets,
      )
      if (reason && !localNames.length) return reason
    }
    const pipeline = (() => {
      if (!conversionMode) return parsed
      const fields = conversionFields ?? {
        merge: builtInMerge ?? false,
        splitMode: splitMode ?? '',
        splitSpan: splitSpan ?? '',
        splitUnify: splitUnify ?? false,
      }
      const form = new FormData()
      for (const [name, value] of Object.entries({
        ...fields,
        ...parseAdvanced(advancedJson ?? ''),
      })) {
        if (value !== '') form.set(name, String(value))
      }
      return planV9ConversionStages(form, documentKind === 'office', parsed, fields)
    })()
    const forwarded = numbersPipelineInputs(pipeline, localNames.length, builtInMerge)
      ? mergeUploadFilenames(localNames, [
          ...remoteMergeFilenames(sourceRemotes),
          ...localAssetNames,
        ])
      : localNames
    if (!archivesPresent) {
      if (documentKind === 'pdf' || documentKind === 'office') {
        validatePipelineSourceUploads(parsed, forwarded, remoteFilenames)
      }
      const remoteNames = remoteStageAssets(
        sourceRemotes,
        [...referencedAssets],
        [...localAssetNames, ...forwarded],
        remoteFilenames,
      )
      parsePdfPipeline(stages, {
        assetNames: [...localAssetNames, ...remoteNames],
        allowUnresolvedAssets: remoteFilenames.some((name) => !name),
        allowEmpty: conversionMode,
        acknowledgedRedaction,
      })
    }
    validatePdfStageUploads(parsed, localAssetNames, conversionMode)
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
      const extensionMatches = (name: string): boolean =>
        documentKind !== 'single' && isV9SourceDocument(documentKind, name, referencedAssets)
      const remoteSources = remoteFilenames.filter(
        (name): name is string => name !== undefined && extensionMatches(name),
      )
      const unknownRemote = documentKind !== 'single' && remoteFilenames.some((name) => !name)
      const sourceInput = (original: string, forwarded = original) =>
        documentKind === 'office'
          ? officePdfComposeInput(original, forwarded)
          : { original, forwarded }
      const sources =
        documentKind === 'single'
          ? outputName
            ? [{ original: `${outputName}.pdf`, forwarded: `${outputName}.pdf` }]
            : []
          : [
              ...localNames.map((name, index) => sourceInput(name, forwarded[index])),
              ...remoteSources.map((name) => sourceInput(name)),
            ]
      if (sources.length || unknownRemote || documentKind === 'single') {
        reconcilePdfComposeSources(pipeline, {
          inputs: sources,
          singleInput: documentKind === 'single',
          unknownInputs: unknownRemote,
          mapBookmarks: true,
        })
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
