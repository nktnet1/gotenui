import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { type ConversionPayload, InputError } from '#/lib/validation'
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
  const features: Record<string, string> = {}
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

function v9PdfStages(form: FormData, operation: Operation, postProcessing: boolean): Stage[] {
  const stages: Stage[] = []
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
  const pdfa = take(form, 'pdfa')
  const pdfua = take(form, 'pdfua') === 'true'
  if (operation.id === 'office-pdf' && !postProcessing && !(pdfa === 'PDF/A-4' && pdfua)) {
    if (pdfa) form.set('nativePdfa', pdfa)
    if (pdfua) form.set('nativePdfua', 'PDF/UA-1')
  } else if (pdfa || pdfua) {
    const profiles = [pdfa, pdfua ? (pdfa === 'PDF/A-4' ? 'PDF/UA-2' : 'PDF/UA-1') : null].filter(
      (profile): profile is string => Boolean(profile),
    )
    stages.push({ op: 'remediate', profile: profiles.length === 1 ? profiles[0] : profiles })
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

function v9OfficeOptions(form: FormData, payload: ConversionPayload): void {
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
): FormData {
  if (version === 8) {
    if (payload.conversionStages || stageFiles.length) {
      throw new InputError('Conversion-time PDF pipeline stages require Gotenberg 9.')
    }
    if (form.has('paperSize')) {
      throw new InputError('Named paper sizes require Gotenberg 9.')
    }
    return form
  }
  if (stageFiles.length && !payload.conversionStages) {
    throw new InputError('Conversion stage file uploads require a configured pipeline.')
  }
  if (!v9ConversionOperationIds.has(operation.id)) {
    throw new InputError(`The ${operation.title} tool has not been migrated to Gotenberg 9.`, 409)
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
  if (operation.path.startsWith('/forms/chromium/')) {
    renameFields(form, chromiumNames)
    v9MediaFeatures(form)
  }
  if (operation.output === 'pdf') {
    const generated = v9PdfStages(form, operation, Boolean(payload.conversionStages))
    const userStages = payload.conversionStages
      ? parsePdfPipeline(payload.conversionStages, {
          assetNames: stageFiles.map(({ name }) => name),
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
      if (!referenced.has(file.name)) {
        throw new InputError(`Unused conversion stage file: ${file.name}.`)
      }
    }
    // Merge/split controls run first; user stages follow; built-in PDF/A remediation
    // stays last so subsequent edits cannot silently invalidate the requested profile.
    const remediation = generated.filter((stage) => stage.op === 'remediate')
    const setup = generated.filter((stage) => stage.op !== 'remediate')
    const stages = [...setup, ...userStages, ...remediation]
    if (stages.length) {
      parsePdfPipeline(JSON.stringify(stages), {
        assetNames: stageFiles.map(({ name }) => name),
        acknowledgedRedaction: payload.acknowledgedConversionRedaction,
      })
      form.set('stages', JSON.stringify(stages))
    }
    for (const file of stageFiles) form.append('files', file, file.name)
  } else if (payload.conversionStages || stageFiles.length) {
    throw new InputError('Conversion-time PDF stages require PDF output.')
  }
  if (operation.id === 'office-pdf') v9OfficeOptions(form, payload)
  return form
}
