import { forwardedRemoteFilenames } from '#/lib/file-names'
import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import {
  mergeUploadFilename,
  mergeUploadFilenames,
  numbersPipelineInputs,
  remoteMergeFilenames,
  reservePrefixedMergeUploadNames,
} from '#/lib/merge-order'
import { OFFICE_V9_EXTENSION_SET } from '#/lib/office-formats'
import { type PdfComposeInput, reconcilePdfComposeSources } from '#/lib/pdf-compose-sources'
import {
  normalizePdfStageAssets,
  type PdfPipelineStage,
  parsePdfPipeline,
  pdfStageAssetNames,
  validatePdfStageUploads,
} from '#/lib/pdf-pipeline'
import { V9_REMEDIATION_FIELD_NAMES, v9RemediationOptions } from '#/lib/pdf-remediation-options'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { type ConversionPayload, InputError, supportsArchiveInputs } from '#/lib/validation'
import type { Operation } from '#/tools/registry'

/** Gotenberg 8 and 9 have different multipart contracts even on unchanged route paths. */
export const chromiumNames = {
  waitWindowStatus: 'waitForWindowStatus',
  nativePageRanges: 'nativePages',
  generateDocumentOutline: 'nativeBookmarks',
  generateTaggedPdf: 'nativeTaggedPdf',
} as const

export const officeNames = {
  nativePageRanges: 'nativePages',
  exportBookmarks: 'nativeBookmarks',
  generateTaggedPdf: 'nativeTaggedPdf',
  singlePageSheets: 'singlePage',
  quality: 'nativeQuality',
  losslessImageCompression: 'nativeLosslessImageCompression',
  reduceImageResolution: 'nativeReduceImageResolution',
  maxImageResolution: 'nativeMaxImageResolution',
  nativeWatermarkFontHeight: 'nativeWatermarkFontSize',
  nativeWatermarkFontName: 'nativeWatermarkFont',
  nativeWatermarkRotateAngle: 'nativeWatermarkRotation',
} as const

const viewerNames = {
  initialView: ['default', 'outline', 'thumbnails'],
  magnification: ['default', 'fitWindow', 'fitWidth', 'fitVisible', 'zoom'],
  pageLayout: ['default', 'singlePage', 'oneColumn', 'twoColumnRight'],
} as const

export const v9ConversionOperationIds = new Set([
  'url-pdf',
  'html-pdf',
  'markdown-pdf',
  'office-pdf',
  'url-shot',
  'html-shot',
  'markdown-shot',
])

function renameFields(form: FormData, names: Readonly<Record<string, string>>): void {
  for (const [from, to] of Object.entries(names)) {
    const value = form.get(from)
    if (value === null) continue
    if (form.has(to)) throw new InputError(`Use either ${from} or ${to}, not both.`)
    form.delete(from)
    form.set(to, value)
  }
}

/** Raw native profiles must not compete with the generated conformance settings. */
export function officeConformanceAliasReason(
  fields: ConversionPayload['fields'],
  advanced: ConversionPayload['advanced'],
): string | null {
  const raw = [advanced.nativePdfa, advanced.nativePdfua].some(
    (value) => value !== undefined && value !== '',
  )
  if (!raw) return null
  if (
    fields.pdfa ||
    fields.pdfua === true ||
    fields.pdfaProfile ||
    fields.pdfuaProfile ||
    (fields.pdfaMethod && fields.pdfaMethod !== 'auto') ||
    Object.keys(v9RemediationOptions(fields)).length
  ) {
    return 'Choose either nativePdfa/nativePdfua in Advanced JSON or the Office PDF conformance settings, not both.'
  }
  return null
}

type Stage = { op: string; [name: string]: unknown }

function take(form: FormData, name: string): string | null {
  const value = form.get(name)
  form.delete(name)
  return typeof value === 'string' ? value : null
}

function v9PdfStages(
  form: FormData,
  operation: Operation,
  postProcessing: boolean,
  fields: ConversionPayload['fields'],
): Stage[] {
  const stages: Stage[] = []
  const remediationOptions = v9RemediationOptions(fields)
  for (const name of V9_REMEDIATION_FIELD_NAMES) form.delete(name)
  if (form.has('stages')) {
    throw new InputError('Advanced stages require the Gotenberg 9 PDF pipeline editor.')
  }
  if (operation.id === 'office-pdf') {
    if (take(form, 'merge') === 'true') stages.push({ op: 'merge' })
  }
  const splitMode = take(form, 'splitMode')
  const splitSpan = take(form, 'splitSpan')
  const unify = take(form, 'splitUnify') === 'true'
  if (splitMode && splitSpan) {
    if (splitMode === 'intervals') {
      stages.push({ op: 'split', every: Number(splitSpan) })
    } else if (unify) {
      stages.push({ op: 'select', pages: splitSpan })
    } else {
      const ranges = splitSpan.split(',').map((range) => range.trim())
      if (ranges.some((range) => !range)) {
        throw new InputError('Split page ranges cannot be empty.')
      }
      stages.push({ op: 'split', ranges })
    }
  }
  const legacyPdfa = take(form, 'pdfa')
  const legacyPdfua = take(form, 'pdfua') === 'true'
  const selectedPdfa = take(form, 'pdfaProfile')
  const selectedPdfua = take(form, 'pdfuaProfile')
  const method = take(form, 'pdfaMethod') || 'auto'
  if (selectedPdfa && legacyPdfa) {
    throw new InputError('Choose either a v9 PDF/A profile or a legacy PDF/A setting.')
  }
  if (selectedPdfua && legacyPdfua) {
    throw new InputError('Choose either a v9 PDF/UA profile or a legacy PDF/UA setting.')
  }
  const pdfa = selectedPdfa || legacyPdfa
  const pdfua =
    selectedPdfua || (legacyPdfua ? (pdfa?.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1') : null)
  if (Object.keys(remediationOptions).length && !pdfa && !pdfua) {
    throw new InputError('Choose PDF/A or PDF/UA before setting remediation options.')
  }
  if (pdfa && pdfua && pdfua !== (pdfa.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1')) {
    throw new InputError('This PDF/A profile cannot be combined with the selected PDF/UA profile.')
  }
  const nativePdfaProfiles = new Set(['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b', 'PDF/A-4'])
  // Gotenberg 9 exports each source PDF natively *before* applying stages.
  // A subsequent merge, split or select can invalidate its conformance. Finish
  // with remediation rather than claiming the native profile on edited PDFs.
  const hasBuiltInStages = stages.length > 0
  const canExportNatively =
    operation.id === 'office-pdf' &&
    !postProcessing &&
    !hasBuiltInStages &&
    !Object.keys(remediationOptions).length &&
    (!pdfa || nativePdfaProfiles.has(pdfa)) &&
    (!pdfua || pdfua === 'PDF/UA-1') &&
    !(pdfa === 'PDF/A-4' && pdfua)
  if (method === 'native' && !canExportNatively) {
    throw new InputError(
      'This combination requires PDF remediation, not native LibreOffice export.',
    )
  }
  if (canExportNatively && method !== 'remediate') {
    if (pdfa) form.set('nativePdfa', pdfa)
    if (pdfua) form.set('nativePdfua', pdfua)
  } else if (pdfa || pdfua) {
    const profiles = [pdfa, pdfua].filter((profile): profile is string => Boolean(profile))
    stages.push({
      op: 'remediate',
      profile: profiles.length === 1 ? profiles[0] : profiles,
      ...remediationOptions,
    })
  }
  const optimize = take(form, 'optimizeImages')
  const imageQuality = take(form, 'imageQuality')
  if (optimize === 'true' || (imageQuality !== null && imageQuality !== '')) {
    throw new InputError(
      'Gotenberg 9 uses lossless PDF optimisation. The Gotenberg 8 JPEG optimisation controls cannot be reused; choose native image quality for Office exports.',
    )
  }
  return stages
}

/** Keep custom LibreOffice page dimensions consistent with Gotenberg 9's Inches parser. */
function validateV9OfficePaper(form: FormData): void {
  const hasDimension = (name: 'paperWidth' | 'paperHeight'): boolean => {
    const raw = form.get(name)
    if (raw === null) return false
    // Gotenberg parses a finite numeric value with an optional CSS length unit.
    const match =
      typeof raw === 'string' &&
      /^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:pt|px|in|mm|cm|pc)?$/.exec(raw)
    if (!match || Number(match[1]) <= 0 || !Number.isFinite(Number(match[1]))) {
      throw new InputError(
        `Gotenberg 9 ${name} must be a positive number with an optional pt, px, in, mm, cm or pc unit.`,
      )
    }
    return true
  }
  const width = hasDimension('paperWidth')
  const height = hasDimension('paperHeight')
  if (!form.has('paperSize') && width !== height) {
    throw new InputError(
      'Gotenberg 9 Office conversion requires both paperWidth and paperHeight, or a named paperSize for the other dimension.',
    )
  }
}

function v9OfficeOptions(form: FormData, payload: ConversionPayload): void {
  validateV9OfficePaper(form)
  const locale = form.get('locale')
  if (
    locale !== null &&
    (typeof locale !== 'string' ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?$/.test(locale))
  ) {
    throw new InputError('LibreOffice locale must be a BCP 47 tag such as en-AU or de-DE.')
  }
  const bookmarks = form.get('openBookmarkLevels')
  if (typeof bookmarks === 'string' && bookmarks !== '') {
    const count = Number(bookmarks)
    if (!Number.isInteger(count) || (count !== -1 && (count < 1 || count > 10))) {
      throw new InputError('Gotenberg 9 bookmark expansion must be -1 (all) or 1 to 10 levels.')
    }
  }
  if (form.has('nativeWatermarkText') && form.has('nativeTiledWatermarkText')) {
    throw new InputError(
      'Gotenberg 9 cannot combine native watermark text with a tiled watermark. Choose one.',
    )
  }
  if (form.has('firstPageOnLeft')) {
    throw new InputError('Gotenberg 9 removed First page on left. Disable it for this connection.')
  }
  renameFields(form, officeNames)
  for (const [name, choices] of Object.entries(viewerNames)) {
    const value = form.get(name)
    if (typeof value !== 'string') continue
    const index = Number(value)
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
      throw new InputError(`Invalid LibreOffice ${name} setting.`)
    }
    form.set(name, choices[index] as string)
  }
  // The v8 encoder sends a decimal RGB integer and tenths of a degree.
  // v9 expects #rrggbb and degrees; the validated original values are authoritative.
  for (const name of ['nativeWatermarkColor', 'nativeWatermarkRotateAngle'] as const) {
    if (!form.has(name === 'nativeWatermarkColor' ? name : 'nativeWatermarkRotation')) continue
    const raw = payload.fields[name] ?? payload.advanced[name]
    if (raw === undefined || raw === '') continue
    form.set(name === 'nativeWatermarkColor' ? name : 'nativeWatermarkRotation', String(raw))
  }
}

/** The 9.x LibreOffice route sorts source documents by filename before running
 * PDF stages. Keep the selected upload order even when merge comes from the
 * pipeline editor rather than the legacy Merge switch.
 */
function orderOfficeMergeInputs(
  form: FormData,
  payload: ConversionPayload,
  stages: readonly Stage[],
  stageFiles: readonly File[],
  archiveEntryNames: readonly string[],
): PdfComposeInput[] | null {
  const sources = form.getAll('files')
  const builtInMerge = payload.fields.merge === true
  // Composing before merging needs the original document filenames.
  if (!numbersPipelineInputs(stages, sources.length, builtInMerge)) return null
  if (sources.some((source) => !(source instanceof File))) {
    throw new InputError('Expected an Office document upload.')
  }

  const filenames = sources.map((source) => (source instanceof File ? source.name : ''))
  const reserved = [
    ...remoteMergeFilenames(payload.downloadFrom),
    ...archiveEntryNames,
    ...stageFiles.map(({ name }) => name),
  ]
  // The v8 form builder already prefixes documents for its Merge switch.
  const ordered = builtInMerge
    ? reservePrefixedMergeUploadNames(filenames, reserved)
    : mergeUploadFilenames(filenames, reserved)
  if (filenames.some((name, index) => name !== ordered[index])) {
    form.delete('files')
    for (const [index, source] of sources.entries()) {
      if (source instanceof File) form.append('files', source, ordered[index])
    }
  }

  return filenames.map((name, index) => {
    const prefix = mergeUploadFilename('', index, sources.length)
    const original = builtInMerge && name.startsWith(prefix) ? name.slice(prefix.length) : name
    return { original: `${original}.pdf`, forwarded: `${ordered[index]}.pdf` }
  })
}

/** Adapt validated v8 UI fields to Gotenberg 9, without modifying the existing v8 encoder. */
export function adaptConversionForm(
  operation: Operation,
  payload: ConversionPayload,
  form: FormData,
  version: SupportedGotenbergMajor,
  stageFiles: readonly File[] = [],
  archives: readonly File[] = [],
  archiveEntryNames: readonly string[] = [],
): FormData {
  if (version === 8) {
    if (
      (payload.fields.pdfa ?? payload.advanced.pdfa) === 'PDF/A-1b' &&
      (payload.fields.pdfua ?? payload.advanced.pdfua) === true
    ) {
      throw new InputError(
        'Gotenberg 8 cannot combine PDF/A-1b and PDF/UA. Select another PDF/A profile.',
      )
    }
    if (payload.conversionStages || stageFiles.length) {
      throw new InputError('Conversion-time PDF pipeline stages require Gotenberg 9.')
    }
    if (archives.length) throw new InputError('ZIP archive inputs require Gotenberg 9.')
    if (form.has('pdfaProfile') || form.has('pdfuaProfile') || form.has('pdfaMethod')) {
      throw new InputError('Advanced PDF conformance profiles require Gotenberg 9.')
    }
    if (V9_REMEDIATION_FIELD_NAMES.some((name) => form.has(name))) {
      throw new InputError('Advanced PDF remediation options require Gotenberg 9.')
    }
    if (form.has('paperSize')) {
      throw new InputError('Named paper sizes require Gotenberg 9.')
    }
    if (operation.id === 'office-pdf' && (form.has('paperWidth') || form.has('paperHeight'))) {
      throw new InputError('Custom Office paper dimensions require Gotenberg 9.')
    }
    return form
  }
  if (stageFiles.length && !payload.conversionStages) {
    throw new InputError('Conversion stage file uploads require a configured pipeline.')
  }
  if (!v9ConversionOperationIds.has(operation.id)) {
    throw new InputError(`The ${operation.title} tool has not been migrated to Gotenberg 9.`, 409)
  }
  if (archives.length && !supportsArchiveInputs(operation)) {
    throw new InputError('ZIP archive inputs are not supported on this route.')
  }
  if (payload.downloadFrom?.some((item) => item.embedded || item.field)) {
    throw new InputError(
      'Gotenberg 9 treats remote downloads as ordinary files. Embedded, watermark and stamp destinations require a v9 PDF pipeline stage; use a Gotenberg 8 connection for these workflows.',
    )
  }
  if (payload.postProcess) {
    throw new InputError(
      'Legacy PDF post-processing requires Gotenberg 8. Recreate the settings as PDF stages on Gotenberg 9.',
    )
  }
  if (operation.path.startsWith('/forms/chromium/')) {
    if (
      operation.output === 'pdf' &&
      form.get('omitBackground') === 'true' &&
      form.get('printBackground') !== 'true'
    ) {
      throw new InputError(
        'Gotenberg 9 Chromium PDF transparency requires Print background graphics.',
      )
    }
    if (operation.output === 'image') {
      const quality = form.get('quality')
      if (typeof quality === 'string' && quality !== '') {
        if (Number(quality) < 1) {
          throw new InputError('Gotenberg 9 screenshot quality must be between 1 and 100.')
        }
        if (form.get('format') !== 'jpeg') {
          throw new InputError('Gotenberg 9 screenshot JPEG quality requires JPEG output.')
        }
      }
    }
    renameFields(form, chromiumNames)
  }
  if (operation.id === 'office-pdf') {
    const reason = officeConformanceAliasReason(payload.fields, payload.advanced)
    if (reason) throw new InputError(reason)
  }
  if (operation.output === 'pdf') {
    const firstUserStages = payload.conversionStages
      ? parsePdfPipeline(payload.conversionStages, {
          allowEmpty: true,
          acknowledgedRedaction: payload.acknowledgedConversionRedaction,
        })
      : []
    const generated = v9PdfStages(form, operation, firstUserStages.length > 0, payload.fields)
    const officeSourceNames =
      operation.id === 'office-pdf'
        ? orderOfficeMergeInputs(
            form,
            payload,
            [...generated.filter(({ op }) => op !== 'remediate'), ...firstUserStages],
            stageFiles,
            archiveEntryNames,
          )
        : null
    const remoteNames = payload.conversionStages
      ? remoteStageAssets(payload.downloadFrom, pdfStageAssetNames(firstUserStages), [
          ...stageFiles.map(({ name }) => name),
          ...archiveEntryNames,
          ...form
            .getAll('files')
            .filter((file): file is File => file instanceof File)
            .map(({ name }) => name),
        ])
      : []
    const userStages = payload.conversionStages
      ? parsePdfPipeline(payload.conversionStages, {
          allowEmpty: true,
          assetNames: [...stageFiles.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
          allowUnresolvedAssets: payload.downloadFrom?.some(
            (remote) => !remote.filename && !remote.name && !remote.field && !remote.embedded,
          ),
          acknowledgedRedaction: payload.acknowledgedConversionRedaction,
        })
      : []
    validatePdfStageUploads(
      userStages,
      stageFiles.map(({ name }) => name),
      true,
    )
    // Remediation must follow page/content edits but precede encryption,
    // signing, document timestamps and final readers. Placing it after a
    // signature would rewrite signed bytes; placing it after encryption would
    // violate Gotenberg's stage ordering even for PDF/UA-only remediation.
    const remediation = generated.filter((stage) => stage.op === 'remediate')
    const setup = generated.filter((stage) => stage.op !== 'remediate')
    const firstFinalizingStage = userStages.findIndex((stage) =>
      ['encrypt', 'sign', 'timestamp', 'render', 'extract-attachments', 'extract-text'].includes(
        stage.op,
      ),
    )
    const remediationAt = firstFinalizingStage === -1 ? userStages.length : firstFinalizingStage
    const stages = [
      ...setup,
      ...userStages.slice(0, remediationAt),
      ...remediation,
      ...userStages.slice(remediationAt),
    ]
    if (stages.length) {
      const referenced = new Set(pdfStageAssetNames(userStages))
      const isOfficeSource = (name: string): boolean =>
        OFFICE_V9_EXTENSION_SET.has(name.slice(name.lastIndexOf('.')).toLowerCase()) &&
        !referenced.has(name.normalize('NFC'))
      const remoteFilenames = forwardedRemoteFilenames(form, payload.downloadFrom)
      const remoteSources = remoteFilenames.filter(
        (name): name is string => name !== undefined && isOfficeSource(name),
      )
      const localSources =
        officeSourceNames ??
        form
          .getAll('files')
          .filter((file): file is File => file instanceof File)
          .map(({ name }) => ({ original: `${name}.pdf`, forwarded: `${name}.pdf` }))
      const mergedStages = reconcilePdfComposeSources(stages as PdfPipelineStage[], {
        inputs:
          operation.id === 'office-pdf'
            ? [
                ...localSources,
                ...archiveEntryNames.filter(isOfficeSource).map((name) => ({
                  original: `${name}.pdf`,
                  forwarded: `${name}.pdf`,
                })),
                ...remoteSources.map((name) => ({
                  original: `${name}.pdf`,
                  forwarded: `${name}.pdf`,
                })),
              ]
            : payload.outputName
              ? [{ original: `${payload.outputName}.pdf`, forwarded: `${payload.outputName}.pdf` }]
              : [],
        singleInput: operation.id !== 'office-pdf',
        unknownInputs: operation.id === 'office-pdf' && remoteFilenames.some((name) => !name),
        mapBookmarks: true,
      })
      parsePdfPipeline(JSON.stringify(mergedStages), {
        assetNames: [...stageFiles.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
        allowUnresolvedAssets: payload.downloadFrom?.some(
          (remote) => !remote.filename && !remote.name && !remote.field && !remote.embedded,
        ),
        acknowledgedRedaction: payload.acknowledgedConversionRedaction,
      })
      form.set('stages', JSON.stringify(normalizePdfStageAssets(mergedStages)))
    }
    for (const file of stageFiles) form.append('files', file, file.name)
  } else if (payload.conversionStages || stageFiles.length) {
    throw new InputError('Conversion-time PDF stages require PDF output.')
  }
  if (operation.id === 'office-pdf') v9OfficeOptions(form, payload)
  for (const archive of archives) form.append('archives', archive, archive.name)
  return form
}
