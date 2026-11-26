import { type RemoteInputRow, remoteInputsPayload } from '#/lib/async-inputs'
import {
  CHROMIUM_REMOTE_FILENAME_VERSION_REASON,
  chromiumOutputPdfName,
  planRemoteFilenames,
  remoteFilenamePlanReason,
  remoteLocalFilenameCollision,
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
import {
  remoteStageAssets,
  validateKnownAssetFilenameRegistration,
} from '#/lib/remote-stage-assets'
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
    chromiumResourceNames = [],
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
    /** Generated Chromium files and ordinary auxiliary uploads. */
    chromiumResourceNames?: readonly string[]
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
    const chromiumNamesAtRisk =
      documentKind === 'single' &&
      (chromiumResourceNames.length > 0 ||
        archivesPresent ||
        !!stages ||
        localAssetNames.length > 0)
    if (chromiumNamesAtRisk && sourceRemotes.length && version?.major === 9 && version.minor < 2) {
      return CHROMIUM_REMOTE_FILENAME_VERSION_REASON
    }
    const filenamePlan = planRemoteFilenames(sourceRemotes, {
      supportsFilename: version?.major === 9 && version.minor >= 2,
      inferAll: localNames.length > 0 || archivesPresent,
      pinAll: localAssetNames.length > 0 || chromiumNamesAtRisk,
      stageAssetNames: referencedAssets,
      protectNamedRemotes: documentKind === 'single',
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
    const numbersInputs = numbersPipelineInputs(pipeline, localNames.length, builtInMerge)
    const forwarded = numbersInputs
      ? mergeUploadFilenames(localNames, [
          ...remoteMergeFilenames(sourceRemotes),
          ...localAssetNames,
        ])
      : localNames
    // Archives can change the reserved names used for merge renaming, but
    // cannot remove collisions involving already-known unrenamed uploads.
    const knownForwarded = archivesPresent && numbersInputs ? [] : forwarded
    if (documentKind === 'pdf' || documentKind === 'office') {
      validatePipelineSourceUploads(parsed, knownForwarded, remoteFilenames)
    }
    const remoteNames = remoteStageAssets(
      sourceRemotes,
      [...referencedAssets],
      [...localAssetNames, ...knownForwarded, ...chromiumResourceNames],
      remoteFilenames,
    )
    if (!archivesPresent) {
      parsePdfPipeline(stages, {
        assetNames: [...localAssetNames, ...remoteNames],
        allowUnresolvedAssets: remoteFilenames.some((name) => !name),
        allowEmpty: conversionMode,
        acknowledgedRedaction,
      })
    }
    if (version?.major === 9) {
      const pinned =
        version.minor >= 2
          ? remoteFilenames.filter((name): name is string => name !== undefined)
          : []
      // Archive entries are not available to synchronous editor validation.
      // Downloads register first regardless of which upload field comes next.
      validateKnownAssetFilenameRegistration(
        pinned,
        [...knownForwarded, ...chromiumResourceNames, ...localAssetNames],
        [],
        [...referencedAssets],
        documentKind === 'single',
      )
      const collision = remoteLocalFilenameCollision(sourceRemotes, [
        ...chromiumResourceNames,
        ...localAssetNames,
      ])
      if (collision) return `Remote filename collides with a local document or asset: ${collision}`
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
    if (version?.major === 9 && version.minor < 2 && stagesUseGotenberg92PageSyntax(pipeline)) {
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
      const chromiumName = chromiumOutputPdfName(outputName)
      const sources =
        documentKind === 'single'
          ? chromiumName
            ? [{ original: chromiumName, forwarded: chromiumName }]
            : []
          : [
              ...remoteSources.map((name) => sourceInput(name)),
              ...localNames.map((name, index) => sourceInput(name, forwarded[index])),
            ]
      if (sources.length || unknownRemote || documentKind === 'single') {
        reconcilePdfComposeSources(pipeline, {
          inputs: sources,
          singleInput: documentKind === 'single',
          unknownInputs: unknownRemote,
          registrationOrderKnown: documentKind !== 'single',
          mapBookmarks: true,
        })
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid PDF pipeline.'
  }
}
