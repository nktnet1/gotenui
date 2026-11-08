import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { reservePrefixedMergeUploadNames } from '#/lib/merge-order'
import { normalizePdfStageAssets, parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import { V9_REMEDIATION_FIELD_NAMES, v9RemediationOptions } from '#/lib/pdf-remediation-options'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { type ConversionPayload, InputError, supportsArchiveInputs } from '#/lib/validation'
import type { Operation } from '#/tools/registry'

/** Gotenberg 8 and 9 have different multipart contracts even on unchanged route paths. */
const chromiumNames = {
  waitWindowStatus: 'waitForWindowStatus',
  nativePageRanges: 'nativePages',
  generateDocumentOutline: 'nativeBookmarks',
  generateTaggedPdf: 'nativeTaggedPdf',
} as const

const officeNames = {
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

/** v8 encodes media features as rows, whereas v9 requires a JSON object. */
function v9MediaFeatures(form: FormData): void {
  const raw = form.get('emulatedMediaFeatures')
  if (typeof raw !== 'string' || !raw) return
  const rows: unknown = JSON.parse(raw)
  if (!Array.isArray(rows)) {
    throw new InputError('Chromium media features must contain name/value pairs.')
  }
  const features: Record<string, string> = Object.create(null)
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new InputError('Invalid Chromium media feature.')
    }
    const { name, value } = item as { name?: unknown; value?: unknown }
    if (typeof name !== 'string' || typeof value !== 'string' || name in features) {
      throw new InputError('Duplicate or invalid Chromium media feature.')
    }
    features[name] = value
  }
  form.set('emulatedMediaFeatures', JSON.stringify(features))
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
      'Complex PDF post-processing is not yet available on Gotenberg 9. Remove the post-processing options or use a Gotenberg 8 connection.',
    )
  }
  if (operation.id === 'office-pdf' && payload.fields.merge === true) {
    // The v8 form builder numbers local documents so Gotenberg's filename sort
    // retains upload order. Reserve filenames used by later stage assets and
    // unpacked archives before sending that same numbered list to Gotenberg 9.
    // Otherwise e.g. report.docx -> 01_report.docx can shadow an attachment
    // named 01_report.docx, causing the stage to read the source document.
    const sources = form.getAll('files')
    if (sources.some((source) => !(source instanceof File))) {
      throw new InputError('Expected an Office document upload.')
    }
    const renamed = reservePrefixedMergeUploadNames(
      sources.map((source) => (source instanceof File ? source.name : '')),
      [
        ...stageFiles.map(({ name }) => name),
        ...archiveEntryNames,
        ...(payload.downloadFrom ?? []).flatMap(({ name }) => (name ? [name] : [])),
      ],
    )
    if (sources.some((source, index) => source instanceof File && source.name !== renamed[index])) {
      form.delete('files')
      for (const [index, source] of sources.entries()) {
        if (source instanceof File) form.append('files', source, renamed[index])
      }
    }
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
      if (typeof quality === 'string' && quality !== '' && Number(quality) < 1) {
        throw new InputError('Gotenberg 9 screenshot quality must be between 1 and 100.')
      }
    }
    renameFields(form, chromiumNames)
    v9MediaFeatures(form)
  }
  if (operation.output === 'pdf') {
    const generated = v9PdfStages(
      form,
      operation,
      Boolean(payload.conversionStages),
      payload.fields,
    )
    const remoteNames = payload.conversionStages
      ? remoteStageAssets(
          payload.downloadFrom,
          pdfStageAssetNames(
            parsePdfPipeline(payload.conversionStages, {
              acknowledgedRedaction: payload.acknowledgedConversionRedaction,
            }),
          ),
          [
            ...stageFiles.map(({ name }) => name),
            ...archiveEntryNames,
            ...form
              .getAll('files')
              .filter((file): file is File => file instanceof File)
              .map(({ name }) => name),
          ],
        )
      : []
    const userStages = payload.conversionStages
      ? parsePdfPipeline(payload.conversionStages, {
          assetNames: [...stageFiles.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
          allowUnresolvedAssets: payload.downloadFrom?.some(
            (remote) => !remote.name && !remote.field && !remote.embedded,
          ),
          acknowledgedRedaction: payload.acknowledgedConversionRedaction,
        })
      : []
    if (userStages.some((stage) => stage.op === 'decrypt')) {
      throw new InputError(
        'Decryption is only available for uploaded PDFs, not newly converted PDFs.',
      )
    }
    const referenced = new Set(
      userStages.flatMap((stage) =>
        ['source', 'image', 'file', 'certificate', 'key', 'xml']
          .map((key) => stage[key])
          .filter((value): value is string => typeof value === 'string'),
      ),
    )
    for (const file of stageFiles) {
      if (!referenced.has(file.name.normalize('NFC'))) {
        throw new InputError(`Unused conversion stage file: ${file.name}.`)
      }
    }
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
      parsePdfPipeline(JSON.stringify(stages), {
        assetNames: [...stageFiles.map(({ name }) => name), ...archiveEntryNames, ...remoteNames],
        allowUnresolvedAssets: payload.downloadFrom?.some(
          (remote) => !remote.name && !remote.field && !remote.embedded,
        ),
        acknowledgedRedaction: payload.acknowledgedConversionRedaction,
      })
      form.set('stages', JSON.stringify(normalizePdfStageAssets(stages)))
    }
    for (const file of stageFiles) form.append('files', file, file.name)
  } else if (payload.conversionStages || stageFiles.length) {
    throw new InputError('Conversion-time PDF stages require PDF output.')
  }
  if (operation.id === 'office-pdf') v9OfficeOptions(form, payload)
  for (const archive of archives) form.append('archives', archive, archive.name)
  return form
}
