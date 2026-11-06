import { parseAttachmentMetadata } from '#/lib/attachment-metadata'
import { adaptV9PdfExtra } from '#/lib/gotenberg-v9-pdf-extra'
import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { adaptPdfPipeline } from '#/lib/pdf-pipeline-adapter'
import { metadataObject } from '#/lib/pdf-structure-editors'
import { type ConversionPayload, InputError } from '#/lib/validation'
import type { Operation } from '#/tools/registry'
import { V9_PDF_IDS } from '#/tools/v9-pdf-config'

type Stage = { op: string; [name: string]: unknown }

const v9PdfOperations = new Set([
  'merge',
  'split',
  'pdfa',
  'optimize',
  'rotate',
  'flatten',
  'encrypt',
  'watermark',
  'stamp',
  'metadata-read',
  'metadata-write',
  'bookmarks-read',
  'bookmarks-write',
  'embed',
  'factur-x',
])

const readRoutes: Readonly<Record<string, string>> = {
  'metadata-read': '/forms/pdf/metadata',
  'bookmarks-read': '/forms/pdf/bookmarks',
}

/** Return the exact target route and form for the detected upstream version. */
export function adaptPdfForm(
  operation: Operation,
  payload: ConversionPayload,
  legacy: FormData,
  major: SupportedGotenbergMajor,
  auxiliary: readonly File[],
  archives: readonly File[] = [],
  archiveEntryNames: readonly string[] = [],
): { path: string; form: FormData } {
  if (major === 8) {
    if (V9_PDF_IDS.has(operation.id) || operation.id === 'pdf-pipeline') {
      throw new InputError(`${operation.title} requires Gotenberg 9.`, 409)
    }
    if (
      Object.keys(payload.fields).some(
        (key) =>
          key.startsWith('v9') && payload.fields[key] !== '' && payload.fields[key] !== false,
      )
    ) {
      throw new InputError('Gotenberg 9 PDF controls cannot be sent to a Gotenberg 8 connection.')
    }
    return { path: operation.path, form: legacy }
  }
  if (operation.id === 'pdf-pipeline') {
    return adaptPdfPipeline(payload, legacy, auxiliary, archives, archiveEntryNames)
  }
  const extra = adaptV9PdfExtra(operation.id, payload, legacy, auxiliary, archives)
  if (extra) return extra
  if (!v9PdfOperations.has(operation.id) || operation.input !== 'pdf') {
    throw new InputError(
      `The ${operation.title} tool is not supported by the Gotenberg 9 PDF adapter.`,
      409,
    )
  }
  if (payload.postProcess) {
    throw new InputError(
      'Gotenberg 9 requires an ordered pipeline for additional PDF post-processing. Remove the extra steps or use a Gotenberg 8 connection until the pipeline editor is available.',
    )
  }
  if (Object.keys(payload.advanced).length) {
    throw new InputError(
      'Gotenberg 8 advanced PDF fields cannot be passed to Gotenberg 9. Use the supported tool settings.',
    )
  }
  if (payload.downloadFrom?.some((item) => item.embedded || item.field)) {
    throw new InputError(
      'Gotenberg 9 PDF tools accept remote input PDFs, but remote attachments and overlays require named pipeline files.',
    )
  }

  const fields = payload.fields
  const output = new FormData()
  for (const entry of legacy.getAll('files')) {
    if (!(entry instanceof File)) throw new InputError('The PDF input must be an uploaded file.')
    output.append('files', entry, entry.name)
  }
  const remote = legacy.get('downloadFrom')
  if (typeof remote === 'string') output.set('downloadFrom', remote)
  for (const archive of archives) output.append('archives', archive, archive.name)
  const stages: Stage[] = []
  const allow = new Set<string>()
  const permitted = (...names: string[]) => {
    for (const name of names) allow.add(name)
  }
  const optional = (name: string): string | undefined => {
    const value = fields[name]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const pdfaStage = (): void => {
    permitted('pdfa', 'pdfua')
    const pdfa = optional('pdfa')
    const pdfua = fields.pdfua === true
    if (!pdfa && !pdfua) return
    const profiles = [
      pdfa,
      pdfua ? (pdfa?.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1') : undefined,
    ].filter((profile): profile is string => Boolean(profile))
    stages.push({ op: 'remediate', profile: profiles.length === 1 ? profiles[0] : profiles })
  }
  const v8Optimization = (): void => {
    permitted('optimizeImages', 'imageQuality')
    if (fields.optimizeImages === true || optional('imageQuality')) {
      throw new InputError(
        'Gotenberg 9 only supports lossless PDF optimization; remove the v8 JPEG quality settings.',
      )
    }
  }
  const attachFile = (file: File): void => {
    if (
      output
        .getAll('files')
        .some((item) => item instanceof File && item.name.toLowerCase() === file.name.toLowerCase())
    ) {
      throw new InputError(
        `The PDF and attachment filenames must be unique on Gotenberg 9: ${file.name}.`,
      )
    }
    output.append('files', file, file.name)
  }

  switch (operation.id) {
    case 'merge': {
      permitted('autoIndexBookmarks', 'titleBookmarks', 'bookmarks', 'metadata')
      v8Optimization()
      if (
        fields.autoIndexBookmarks === true ||
        fields.titleBookmarks === true ||
        optional('bookmarks') ||
        optional('metadata')
      ) {
        throw new InputError(
          'Gotenberg 9 merge cannot translate the v8 bookmark/index and metadata settings without changing their meaning. Apply them in a separate PDF step.',
        )
      }
      stages.push({ op: 'merge' })
      pdfaStage()
      break
    }
    case 'split': {
      permitted('splitMode', 'splitSpan', 'splitUnify')
      v8Optimization()
      const span = optional('splitSpan')
      if (!span) throw new InputError('Select pages or an interval to split.')
      if (fields.splitMode === 'intervals') {
        const every = Number(span)
        if (!Number.isSafeInteger(every) || every < 1)
          throw new InputError('Split interval must be a positive integer.')
        stages.push({ op: 'split', every })
      } else if (fields.splitMode === 'pages') {
        if (fields.splitUnify === true) {
          stages.push({ op: 'select', pages: span })
        } else {
          const ranges = span.split(',').map((part) => part.trim())
          if (ranges.some((part) => !part))
            throw new InputError('Split page ranges must not be empty.')
          stages.push({ op: 'split', ranges })
        }
      } else {
        throw new InputError('Choose a supported split mode.')
      }
      pdfaStage()
      break
    }
    case 'pdfa':
      pdfaStage()
      if (!stages.length) throw new InputError('Choose PDF/A or PDF/UA remediation.')
      break
    case 'optimize':
      permitted('imageQuality')
      if (optional('imageQuality')) {
        throw new InputError(
          'Gotenberg 9 optimization is lossless; its PDF pipeline has no image quality slider.',
        )
      }
      stages.push({ op: 'optimize' })
      break
    case 'rotate': {
      permitted('rotateAngle', 'rotatePages')
      stages.push({
        op: 'rotate',
        angle: Number(fields.rotateAngle),
        ...(optional('rotatePages') ? { pages: optional('rotatePages') } : {}),
      })
      break
    }
    case 'flatten':
      permitted('v9FlattenFormsOnly')
      if (fields.v9FlattenFormsOnly !== true) {
        throw new InputError(
          'Gotenberg 9 flattens form fields, not annotations. Confirm this difference in the v9 form before continuing.',
        )
      }
      stages.push({ op: 'flatten-form' })
      break
    case 'encrypt': {
      permitted(
        'userPassword',
        'ownerPassword',
        'allowPrinting',
        'allowCopying',
        'allowModifying',
        'allowAnnotating',
        'allowFillingForms',
        'allowAssembling',
      )
      const mapped: Readonly<Record<string, readonly string[]>> = {
        allowPrinting: ['print', 'printHighQuality'],
        allowCopying: ['extractText'],
        allowModifying: ['modifyContent'],
        allowAnnotating: ['modifyAnnotations'],
        allowFillingForms: ['fillForms'],
        allowAssembling: ['assemble'],
      }
      const permissions: Record<string, boolean> = {}
      for (const [name, keys] of Object.entries(mapped)) {
        if (typeof fields[name] !== 'boolean') continue
        for (const key of keys) permissions[key] = fields[name]
      }
      stages.push({
        op: 'encrypt',
        ...(optional('userPassword') ? { userPassword: fields.userPassword } : {}),
        ...(optional('ownerPassword') ? { ownerPassword: fields.ownerPassword } : {}),
        ...(Object.keys(permissions).length ? { permissions } : {}),
      })
      break
    }
    case 'watermark':
    case 'stamp': {
      const kind = operation.id
      permitted(`${kind}Source`, `${kind}Expression`, `${kind}Pages`, `${kind}Options`)
      permitted(
        'v9OverlayAcknowledged',
        'v9OverlayX',
        'v9OverlayY',
        'v9OverlayFontSize',
        'v9OverlayWidth',
        'v9OverlayHeight',
        'v9OverlayScale',
      )
      if (fields.v9OverlayAcknowledged !== true) {
        throw new InputError(
          'Gotenberg 9 places stamps over page content with bottom-left coordinates. Confirm this difference before continuing.',
        )
      }
      const source = fields[`${kind}Source`]
      const expression = optional(`${kind}Expression`)
      if (!expression) throw new InputError('Enter overlay text or the exact uploaded filename.')
      const options = overlayOptions(optional(`${kind}Options`))
      const common: Record<string, unknown> = {
        ...(optional(`${kind}Pages`) ? { pages: optional(`${kind}Pages`) } : {}),
        x: coordinate(fields.v9OverlayX, 48),
        y: coordinate(fields.v9OverlayY, 48),
        ...(options.rotation !== undefined ? { rotation: options.rotation } : {}),
        // pdfcpu opacity runs 0 (invisible) to 1 (opaque), litho is the inverse.
        ...(options.opacity !== undefined ? { opacity: 1 - options.opacity } : {}),
      }
      if (source === 'text') {
        stages.push({
          op: 'stamp-text',
          text: expression,
          ...common,
          fontSize: coordinate(fields.v9OverlayFontSize, options.points ?? 24),
          ...(options.fontname ? { font: options.fontname } : {}),
          ...(options.color ? { color: options.color } : {}),
        })
      } else if (source === 'image' || source === 'pdf') {
        if (auxiliary.length !== 1 || auxiliary[0]?.name !== expression) {
          throw new InputError('Upload one overlay file whose name matches the expression field.')
        }
        const asset = auxiliary[0]
        if (source === 'image' && !/\.(png|jpe?g)$/i.test(asset.name)) {
          throw new InputError('Gotenberg 9 PDF image stamps accept only PNG or JPEG assets.')
        }
        if (source === 'pdf' && !/\.pdf$/i.test(asset.name)) {
          throw new InputError('A PDF overlay requires an uploaded PDF.')
        }
        attachFile(asset)
        stages.push(
          source === 'image'
            ? {
                op: 'stamp-image',
                image: asset.name,
                ...common,
                width: coordinate(fields.v9OverlayWidth, 0),
                height: coordinate(fields.v9OverlayHeight, 0),
              }
            : {
                op: 'stamp-pdf',
                source: asset.name,
                ...common,
                ...(optional('v9OverlayScale')
                  ? { scale: coordinate(fields.v9OverlayScale, 1) }
                  : {}),
              },
        )
      } else {
        throw new InputError('Choose text, an image, or a PDF overlay.')
      }
      break
    }
    case 'metadata-read':
    case 'bookmarks-read':
      break
    case 'metadata-write': {
      permitted('metadata')
      const raw = optional('metadata')
      if (!raw) throw new InputError('Enter metadata to write.')
      const source = metadataObject(raw)
      const translated: Record<string, string> = {}
      const mapping: Readonly<Record<string, string>> = {
        Title: 'title',
        Author: 'author',
        Subject: 'subject',
        Keywords: 'keywords',
        Creator: 'creator',
        Producer: 'producer',
        CreationDate: 'creationDate',
        ModDate: 'modDate',
      }
      for (const [name, value] of Object.entries(source)) {
        const key = mapping[name] ?? (Object.values(mapping).includes(name) ? name : null)
        if (!key) throw new InputError(`Gotenberg 9 cannot write the v8 metadata key '${name}'.`)
        const normalized =
          key === 'keywords' &&
          Array.isArray(value) &&
          value.every((item) => typeof item === 'string')
            ? value.join(', ')
            : value
        if (typeof normalized !== 'string')
          throw new InputError(`Gotenberg 9 metadata '${name}' must be a string.`)
        translated[key] = normalized
      }
      stages.push({ op: 'set-metadata', ...translated })
      break
    }
    case 'bookmarks-write': {
      permitted('bookmarks')
      const raw = optional('bookmarks')
      if (!raw) throw new InputError('Enter bookmarks to write.')
      let decoded: unknown
      try {
        decoded = JSON.parse(raw)
      } catch {
        throw new InputError('Invalid bookmark JSON.')
      }
      if (!Array.isArray(decoded)) {
        throw new InputError(
          'Gotenberg 9 requires one shared bookmark tree. Per-filename bookmark maps are supported by Gotenberg 8 only.',
        )
      }
      stages.push({ op: 'set-bookmarks', bookmarks: toV9Bookmarks(decoded) })
      break
    }
    case 'embed': {
      permitted('embedsMetadata')
      const metadata = parseAttachmentMetadata(optional('embedsMetadata'))
      if (!metadata) throw new InputError('Invalid PDF attachment metadata.')
      if (!auxiliary.length)
        throw new InputError('Gotenberg 9 attachment stages require local uploaded files.')
      for (const file of auxiliary) {
        attachFile(file)
        stages.push({ op: 'attach', file: file.name, ...(metadata[file.name] ?? {}) })
      }
      break
    }
    case 'factur-x': {
      permitted('facturxConformanceLevel', 'facturxDocumentType', 'facturxVersion', 'pdfa', 'pdfua')
      if (optional('facturxVersion'))
        throw new InputError(
          'Gotenberg 9 Factur-X remediation does not support the v8 Factur-X version field.',
        )
      if (optional('pdfa') && optional('pdfa') !== 'PDF/A-3b') {
        throw new InputError(
          'Gotenberg 9 Factur-X remediation produces PDF/A-3b. Remove the PDF/A-3a or PDF/A-3u selection to avoid changing the requested compliance profile.',
        )
      }
      if (auxiliary.length !== 1 || !/\.xml$/i.test(auxiliary[0]?.name ?? '')) {
        throw new InputError('Upload one Factur-X XML invoice.')
      }
      const xml = auxiliary[0]
      attachFile(xml)
      stages.push({
        op: 'remediate',
        profile: fields.pdfua === true ? ['Factur-X', 'PDF/UA-1'] : 'Factur-X',
        xml: xml.name,
        level: fields.facturxConformanceLevel,
        ...(optional('facturxDocumentType') ? { documentType: fields.facturxDocumentType } : {}),
      })
      break
    }
    default:
      throw new InputError(`Unknown PDF tool: ${operation.id}.`)
  }

  for (const [name, value] of Object.entries(fields)) {
    if (allow.has(name)) continue
    if (value === undefined || value === '' || value === false) continue
    throw new InputError(`Gotenberg 9 does not support the '${name}' field on ${operation.title}.`)
  }
  if (!readRoutes[operation.id]) output.set('stages', JSON.stringify(stages))
  return { path: readRoutes[operation.id] ?? '/forms/pdf/pipe', form: output }
}

function coordinate(value: string | boolean | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' || !Number.isFinite(Number(value)))
    throw new InputError('Overlay coordinates must be finite numbers.')
  return Number(value)
}

/** pdfcpu's legacy JSON settings are not interchangeable with litho geometry. */
function overlayOptions(raw: string | undefined): {
  opacity?: number
  rotation?: number
  points?: number
  fontname?: string
  color?: string
} {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InputError('Invalid overlay options JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new InputError('Overlay options must be a JSON object.')
  const options = parsed as Record<string, unknown>
  for (const key of Object.keys(options)) {
    if (!['opacity', 'rotation', 'points', 'fontname', 'font', 'color'].includes(key)) {
      throw new InputError(
        `The v8 overlay option '${key}' cannot be translated to Gotenberg 9 coordinates. Use the v9 placement fields.`,
      )
    }
  }
  for (const key of ['opacity', 'rotation', 'points'] as const) {
    const value = options[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new InputError(`${key} must be a finite number.`)
  }
  const opacity = options.opacity as number | undefined
  if (opacity !== undefined && (opacity < 0 || opacity > 1))
    throw new InputError('Opacity must be between 0 and 1.')
  for (const key of ['fontname', 'font', 'color'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'string')
      throw new InputError(`${key} must be text.`)
  }
  return {
    ...(opacity !== undefined ? { opacity } : {}),
    ...(options.rotation !== undefined ? { rotation: options.rotation as number } : {}),
    ...(options.points !== undefined ? { points: options.points as number } : {}),
    ...(options.fontname || options.font
      ? { fontname: (options.fontname ?? options.font) as string }
      : {}),
    ...(options.color ? { color: options.color as string } : {}),
  }
}

function toV9Bookmarks(nodes: unknown[]): unknown[] {
  return nodes.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node))
      throw new InputError('Every bookmark must be an object.')
    const entry = node as Record<string, unknown>
    if (
      Object.keys(entry).some((key) => !['title', 'page', 'pageNumber', 'children'].includes(key))
    ) {
      throw new InputError('Gotenberg 9 does not support extra bookmark properties in this editor.')
    }
    if (
      entry.page !== undefined &&
      entry.pageNumber !== undefined &&
      entry.page !== entry.pageNumber
    ) {
      throw new InputError('A bookmark cannot specify different page and pageNumber values.')
    }
    const pageNumber = entry.pageNumber ?? entry.page
    if (
      !Number.isSafeInteger(pageNumber) ||
      (pageNumber as number) < 1 ||
      typeof entry.title !== 'string' ||
      !entry.title.trim()
    ) {
      throw new InputError('Each bookmark needs a title and a positive page number.')
    }
    if (entry.children !== undefined && !Array.isArray(entry.children))
      throw new InputError('Bookmark children must be an array.')
    return {
      title: entry.title,
      pageNumber,
      ...(entry.children ? { children: toV9Bookmarks(entry.children) } : {}),
    }
  })
}
