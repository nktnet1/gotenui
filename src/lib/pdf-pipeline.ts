/** Gotenberg 9 PDF pipeline catalogue and shared client/server validation.
 * Keep this aligned with pkg/modules/pdf/stages.go and stage_types.go.
 */

import { isAttachmentMimeType } from '#/lib/attachment-metadata'
import { isPdfMetadataDate } from '#/lib/pdf-metadata-date'
import { isPdfPageSelector } from '#/lib/pdf-page-selectors'
import { timestampAuthorityUrl } from '#/lib/timestamp-authority'
import { InputError } from '#/lib/validation'

export const PDF_PIPELINE_STAGES = [
  {
    op: 'merge',
    label: 'Merge documents',
    description: 'Join all input PDFs in order.',
    options: {},
    fields: [],
  },
  {
    op: 'compose',
    label: 'Compose pages',
    description:
      'Place source PDF pages on new sheets. sourcePage and page are one-based (0 also means first); page 2 creates the second sheet. Each input PDF must be placed; coordinates are in points (Gotenberg 9.2+).',
    options: { paperSize: 'A4', placements: [{ sourcePage: 1, page: 1, x: 0, y: 0 }] },
    fields: ['paperSize', 'paperWidth', 'paperHeight', 'placements'],
  },
  {
    op: 'split',
    label: 'Split documents',
    description: 'Split by a page interval or named ranges.',
    options: { every: 1 },
    fields: ['every', 'ranges'],
  },
  {
    op: 'select',
    label: 'Select pages',
    description: 'Keep specified pages in the given order.',
    options: { pages: '1' },
    fields: ['pages'],
  },
  {
    op: 'delete',
    label: 'Delete pages',
    description: 'Remove selected pages.',
    options: { pages: '1' },
    fields: ['pages'],
  },
  {
    op: 'insert',
    label: 'Insert pages',
    description: 'Insert pages from an additional uploaded PDF.',
    options: { source: 'insert.pdf', at: 0 },
    fields: ['source', 'at', 'sourcePages'],
  },
  {
    op: 'rotate',
    label: 'Rotate pages',
    description: 'Rotate selected pages in multiples of 90 degrees.',
    options: { angle: 90 },
    fields: ['angle', 'pages'],
  },
  {
    op: 'stamp-text',
    label: 'Stamp text',
    description: 'Draw text over PDF content.',
    options: { text: 'DRAFT', x: 48, y: 48, fontSize: 24 },
    fields: ['text', 'pages', 'x', 'y', 'fontSize', 'font', 'color', 'opacity', 'rotation'],
  },
  {
    op: 'stamp-image',
    label: 'Stamp image',
    description: 'Overlay an uploaded PNG or JPEG.',
    options: { image: 'stamp.png', x: 48, y: 48 },
    fields: ['image', 'pages', 'x', 'y', 'width', 'height', 'opacity', 'rotation'],
  },
  {
    op: 'stamp-pdf',
    label: 'Stamp PDF',
    description: 'Overlay a page from an additional PDF.',
    options: { source: 'stamp.pdf', x: 48, y: 48 },
    fields: ['source', 'sourcePage', 'pages', 'x', 'y', 'scale', 'opacity', 'rotation'],
  },
  {
    op: 'set-metadata',
    label: 'Set metadata',
    description:
      'Update standard PDF document properties. Dates use PDF syntax, e.g. D:20261001090000Z.',
    options: { title: 'Updated document' },
    fields: [
      'title',
      'author',
      'subject',
      'keywords',
      'creator',
      'producer',
      'creationDate',
      'modDate',
    ],
  },
  {
    op: 'set-bookmarks',
    label: 'Set bookmarks',
    description: 'Replace the outline with a bookmark tree.',
    options: { bookmarks: [{ title: 'Introduction', pageNumber: 1 }] },
    fields: ['bookmarks'],
  },
  {
    op: 'set-form',
    label: 'Fill form',
    description: 'Set named interactive form values.',
    options: { fields: { customer: 'Example' } },
    fields: ['fields'],
  },
  {
    op: 'flatten-form',
    label: 'Flatten form',
    description: 'Burn completed form fields into page content.',
    options: {},
    fields: [],
  },
  {
    op: 'flatten-transparency',
    label: 'Flatten transparency',
    description: 'Remove transparency from content.',
    options: {},
    fields: [],
  },
  {
    op: 'convert-colors',
    label: 'Convert colours',
    description: 'Convert to RGB, CMYK or grayscale.',
    options: { target: 'rgb' },
    fields: ['target'],
  },
  {
    op: 'redact',
    label: 'Redact content',
    description: 'Permanently remove content in rectangles; omitted x/y coordinates default to 0.',
    options: { regions: [{ page: 1, x: 50, y: 50, width: 100, height: 30 }] },
    fields: ['regions'],
  },
  {
    op: 'autotag',
    label: 'Autotag',
    description: 'Infer an accessibility structure tree.',
    options: {},
    fields: [],
  },
  {
    op: 'attach',
    label: 'Attach file',
    description: 'Embed an uploaded attachment.',
    options: { file: 'attachment.txt' },
    fields: ['file', 'name', 'mimeType', 'relationship'],
  },
  {
    op: 'detach',
    label: 'Detach file',
    description: 'Remove an embedded attachment by name.',
    options: { name: 'attachment.txt' },
    fields: ['name'],
  },
  {
    op: 'extract-attachments',
    label: 'Extract attachments',
    description: 'Download embedded files. Must be the final stage (Gotenberg 9.1+).',
    options: {},
    fields: ['name'],
  },
  {
    op: 'extract-text',
    label: 'Extract text',
    description: 'Save text as .txt. Scanned pages need external OCR. Final stage (9.1+).',
    options: {},
    fields: ['pages', 'invisible', 'artifacts', 'annotations'],
  },
  {
    op: 'optimize',
    label: 'Optimise',
    description: 'Losslessly optimise PDF contents.',
    options: {},
    fields: ['objectStreams', 'dedup', 'recompressImages', 'subsetFonts'],
  },
  {
    op: 'encrypt',
    label: 'Encrypt',
    description: 'Password-protect a PDF and set permissions.',
    options: { userPassword: '' },
    fields: ['userPassword', 'ownerPassword', 'algorithm', 'permissions'],
  },
  {
    op: 'decrypt',
    label: 'Decrypt',
    description: 'Open and decrypt a password-protected PDF. Must be first.',
    options: { password: '' },
    fields: ['password'],
  },
  {
    op: 'remediate',
    label: 'Remediate PDF',
    description: 'Repair PDF/A, PDF/UA or Factur-X conformance.',
    options: { profile: 'PDF/A-2b' },
    fields: ['profile', 'language', 'aggressive', 'figureAltText', 'xml', 'level', 'documentType'],
  },
  {
    op: 'sign',
    label: 'Digitally sign',
    description: 'Sign with an uploaded certificate and optional key.',
    options: { certificate: 'certificate.p12' },
    fields: [
      'certificate',
      'key',
      'certificatePassword',
      'reason',
      'location',
      'contactInfo',
      'name',
      'pades',
      'timestampUrl',
    ],
  },
  {
    op: 'timestamp',
    label: 'Timestamp',
    description: 'Request an RFC 3161 document timestamp.',
    options: { timestampUrl: '' },
    fields: ['timestampUrl'],
  },
  {
    op: 'render',
    label: 'Render pages',
    description:
      'Render final PDF pages as PNG/JPEG. Must be last. Gotenberg 9.3+ may require lower DPI if the server pixel budget is exceeded.',
    options: { pages: '1', format: 'png' },
    fields: ['pages', 'dpi', 'format', 'quality'],
  },
] as const

export type PdfPipelineOp = (typeof PDF_PIPELINE_STAGES)[number]['op']
export type PdfPipelineStage = { op: PdfPipelineOp; [key: string]: unknown }

export const DEFAULT_PDF_PIPELINE = '[{"op":"optimize"}]'
const pipelineByOp = new Map<string, (typeof PDF_PIPELINE_STAGES)[number]>(
  PDF_PIPELINE_STAGES.map((stage) => [stage.op, stage]),
)
const profiles = new Set([
  'PDF/A-1a',
  'PDF/A-1b',
  'PDF/A-2a',
  'PDF/A-2b',
  'PDF/A-2u',
  'PDF/A-3a',
  'PDF/A-3b',
  'PDF/A-3u',
  'PDF/A-4',
  'PDF/A-4e',
  'PDF/A-4f',
  'PDF/UA-1',
  'PDF/UA-2',
  'Factur-X',
])
// Gotenberg 9's PDF stage parser accepts exactly these standard PDF fonts.
const stampFonts = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
])
const facturXLevels = new Set(['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'])
const permissions = new Set([
  'print',
  'printHighQuality',
  'modifyContent',
  'extractText',
  'modifyAnnotations',
  'fillForms',
  'assemble',
])
const requiredText = (stage: PdfPipelineStage, key: string): string => {
  const value = stage[key]
  // Uploaded asset and embedded attachment names are exact. In particular,
  // Gotenberg does not trim names consisting entirely of spaces.
  if (typeof value !== 'string' || value === '') {
    throw new InputError(`${stage.op}: "${key}" must be a non-empty string.`)
  }
  return value
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalPages = (stage: PdfPipelineStage, key: string): void => {
  const value = stage[key]
  // Litho interprets an omitted, empty, or whitespace-only optional page range as all pages.
  if (
    value !== undefined &&
    !(typeof value === 'string' && !value.trim()) &&
    !isPdfPageSelector(value)
  ) {
    throw new InputError(
      `${stage.op}: "${key}" must select pages such as 1-3, 3-, !1, last or all.`,
    )
  }
}
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max

function validateStage(stage: PdfPipelineStage): void {
  const name = stage.op
  const known = pipelineByOp.get(name)
  if (!known) throw new InputError(`Unknown PDF stage: ${name}.`)
  for (const key of Object.keys(stage)) {
    if (key !== 'op' && !(known.fields as readonly string[]).includes(key)) {
      throw new InputError(`${name}: unknown option "${key}".`)
    }
  }
  const stringOptions = new Set([
    'text',
    'font',
    'color',
    'image',
    'source',
    'title',
    'author',
    'subject',
    'keywords',
    'creator',
    'producer',
    'creationDate',
    'modDate',
    'target',
    'file',
    'name',
    'mimeType',
    'relationship',
    'userPassword',
    'ownerPassword',
    'algorithm',
    'password',
    'language',
    'figureAltText',
    'xml',
    'level',
    'documentType',
    'certificate',
    'key',
    'certificatePassword',
    'reason',
    'location',
    'contactInfo',
    'timestampUrl',
    'format',
    'paperSize',
    'paperWidth',
    'paperHeight',
  ])
  for (const [key, value] of Object.entries(stage)) {
    if (stringOptions.has(key) && typeof value !== 'string') {
      throw new InputError(`${name}: "${key}" must be a string.`)
    }
  }
  for (const key of ['pages', 'sourcePages']) optionalPages(stage, key)
  for (const key of ['x', 'y', 'width', 'height', 'scale', 'fontSize', 'opacity', 'rotation']) {
    const value = stage[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new InputError(`${name}: "${key}" must be a finite number.`)
    }
  }
  for (const key of ['angle', 'at', 'every', 'sourcePage', 'dpi', 'quality']) {
    const value = stage[key]
    if (value !== undefined && !integer(value, key === 'at' || key === 'sourcePage' ? 0 : 1)) {
      // Rotation allows negative multiples of 90 as well as zero.
      if (key !== 'angle' || !Number.isSafeInteger(value)) {
        throw new InputError(`${name}: "${key}" must be a valid integer.`)
      }
    }
  }
  for (const key of [
    'invisible',
    'artifacts',
    'annotations',
    'objectStreams',
    'dedup',
    'recompressImages',
    'subsetFonts',
    'aggressive',
    'pades',
  ]) {
    if (stage[key] !== undefined && typeof stage[key] !== 'boolean') {
      throw new InputError(`${name}: "${key}" must be true or false.`)
    }
  }
  if (
    stage.opacity !== undefined &&
    ((stage.opacity as number) < 0 || (stage.opacity as number) > 1)
  ) {
    throw new InputError(`${name}: opacity must be from 0 to 1.`)
  }
  if (stage.scale !== undefined && (stage.scale as number) <= 0)
    throw new InputError(`${name}: scale must be positive.`)
  if (stage.fontSize !== undefined && (stage.fontSize as number) <= 0)
    throw new InputError(`${name}: font size must be positive.`)
  if (stage.permissions !== undefined) {
    if (
      !object(stage.permissions) ||
      Object.entries(stage.permissions).some(
        ([key, value]) => !permissions.has(key) || typeof value !== 'boolean',
      )
    ) {
      throw new InputError('encrypt: permissions must contain only supported boolean permissions.')
    }
  }
  switch (name) {
    case 'set-metadata':
      for (const key of ['creationDate', 'modDate'] as const) {
        if (stage[key] !== undefined && !isPdfMetadataDate(stage[key] as string)) {
          throw new InputError(`${name}: "${key}" must be a PDF date such as D:20261001090000Z.`)
        }
      }
      break
    case 'compose': {
      const sizes = ['A3', 'A4', 'A5', 'B4', 'B5', 'Letter', 'Legal', 'Tabloid']
      const paperSize = stage.paperSize as string | undefined
      if (paperSize && !sizes.some((size) => size.toLowerCase() === paperSize.toLowerCase())) {
        throw new InputError('compose: unsupported paperSize.')
      }
      for (const side of ['paperWidth', 'paperHeight'] as const) {
        const length = stage[side] as string | undefined
        if (length === undefined || length === '') continue
        const match = /^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:pt|px|in|mm|cm|pc)?$/.exec(
          length,
        )
        if (!match || !Number.isFinite(Number(match[1])) || Number(match[1]) <= 0) {
          throw new InputError(`compose: "${side}" must be a positive length such as 6in or 432pt.`)
        }
      }
      if (!paperSize && (!stage.paperWidth || !stage.paperHeight)) {
        throw new InputError('compose: set paperSize, or both paperWidth and paperHeight.')
      }
      if (!Array.isArray(stage.placements) || !stage.placements.length) {
        throw new InputError('compose: placements must contain at least one page placement.')
      }
      for (const [index, placement] of stage.placements.entries()) {
        if (
          !object(placement) ||
          Object.keys(placement).some(
            (key) => !['source', 'sourcePage', 'page', 'x', 'y', 'scale', 'rotation'].includes(key),
          ) ||
          (placement.source !== undefined && typeof placement.source !== 'string') ||
          ['sourcePage', 'page'].some(
            (key) => placement[key] !== undefined && !integer(placement[key], 0),
          ) ||
          ['x', 'y', 'rotation'].some(
            (key) =>
              placement[key] !== undefined &&
              (typeof placement[key] !== 'number' || !Number.isFinite(placement[key])),
          ) ||
          (placement.scale !== undefined &&
            (typeof placement.scale !== 'number' ||
              !Number.isFinite(placement.scale) ||
              placement.scale <= 0))
        ) {
          throw new InputError(`compose: invalid placements entry ${index + 1}.`)
        }
      }
      break
    }
    case 'split': {
      // Go decides whether ranges are supplied by their length, not merely
      // whether the JSON property exists. [] is valid alongside "every".
      if (stage.ranges !== undefined && stage.ranges !== null && !Array.isArray(stage.ranges))
        throw new InputError('split: ranges must be an array of page selectors.')
      const ranges = (stage.ranges ?? []) as unknown[]
      if ((stage.every === undefined) === (ranges.length === 0))
        throw new InputError('split: choose either every or ranges.')
      if (ranges.some((page) => !isPdfPageSelector(page)))
        throw new InputError('split: ranges must be a non-empty array of page selectors.')
      break
    }
    case 'select':
    case 'delete':
      if (!requiredText(stage, 'pages').trim())
        throw new InputError(`${name}: "pages" must be a non-empty string.`)
      break
    case 'insert':
      // Gotenberg resolves this named asset and opens its PDF contents;
      // unlike a source document, its filename need not end in .pdf.
      requiredText(stage, 'source')
      if (stage.at !== undefined && !integer(stage.at, 0))
        throw new InputError('insert: at must be a non-negative integer.')
      break
    case 'rotate':
      if (!Number.isSafeInteger(stage.angle) || (stage.angle as number) % 90 !== 0)
        throw new InputError('rotate: angle must be a multiple of 90.')
      break
    case 'stamp-text':
      // Litho rejects only the empty string; whitespace is valid stamp content.
      if (stage.text === '' || stage.text === undefined)
        throw new InputError('stamp-text: text must be non-empty.')
      if (stage.font && !stampFonts.has(stage.font as string))
        throw new InputError('stamp-text: font must be one of the 14 standard PDF fonts.')
      if (stage.color && !/^#[\da-fA-F]{6}$/.test(stage.color as string))
        throw new InputError('stamp-text: color must be a #rrggbb hexadecimal colour.')
      break
    case 'stamp-image':
      if (!/\.(png|jpe?g)$/i.test(requiredText(stage, 'image')))
        throw new InputError('stamp-image: upload PNG or JPEG.')
      break
    case 'stamp-pdf':
      requiredText(stage, 'source')
      break
    case 'set-bookmarks': {
      if (!Array.isArray(stage.bookmarks) || !stage.bookmarks.length)
        throw new InputError('set-bookmarks: add at least one bookmark.')
      const check = (entries: unknown[]): void => {
        const pending = [...entries]
        while (pending.length) {
          const entry = pending.pop()
          if (
            !object(entry) ||
            typeof entry.title !== 'string' ||
            !entry.title.trim() ||
            !integer(entry.pageNumber, 1)
          )
            throw new InputError(
              'set-bookmarks: every bookmark needs a title and positive pageNumber.',
            )
          if (entry.children !== undefined) {
            if (!Array.isArray(entry.children))
              throw new InputError('set-bookmarks: invalid children.')
            pending.push(...entry.children)
          }
        }
      }
      check(stage.bookmarks)
      break
    }
    case 'set-form':
      if (
        !object(stage.fields) ||
        !Object.keys(stage.fields).length ||
        Object.entries(stage.fields).some(
          ([_key, value]) =>
            !(
              typeof value === 'string' ||
              (Array.isArray(value) && value.every((item) => typeof item === 'string'))
            ),
        )
      )
        throw new InputError('set-form: fields must map names to strings or arrays of strings.')
      break
    case 'convert-colors':
      if (!['cmyk', 'rgb', 'gray', 'output-intent'].includes(String(stage.target)))
        throw new InputError('convert-colors: invalid target.')
      break
    case 'redact':
      if (!Array.isArray(stage.regions) || !stage.regions.length)
        throw new InputError('redact: provide at least one rectangle.')
      for (const region of stage.regions) {
        if (
          !object(region) ||
          !integer(region.page, 1) ||
          Object.keys(region).some((key) => !['page', 'x', 'y', 'width', 'height'].includes(key)) ||
          !['width', 'height'].every((key) => {
            const value = region[key]
            return typeof value === 'number' && Number.isFinite(value) && value > 0
          }) ||
          ['x', 'y'].some((key) => {
            const value = region[key]
            return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))
          })
        )
          throw new InputError('redact: invalid rectangle coordinates.')
      }
      break
    case 'attach':
      requiredText(stage, 'file')
      if (
        stage.relationship !== undefined &&
        !['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified', ''].includes(
          String(stage.relationship),
        )
      )
        throw new InputError('attach: unsupported attachment relationship.')
      if (
        stage.mimeType !== undefined &&
        stage.mimeType !== '' &&
        !isAttachmentMimeType(String(stage.mimeType))
      )
        throw new InputError('attach: invalid MIME type.')
      break
    case 'detach':
      requiredText(stage, 'name')
      break
    case 'extract-attachments':
      // A missing or empty name extracts every attachment; non-empty names match exactly.
      break
    case 'encrypt':
      if (!stage.userPassword && !stage.ownerPassword)
        throw new InputError('encrypt: enter a user or owner password.')
      if (
        stage.algorithm !== undefined &&
        !['', 'aes256', 'aes128', 'rc4-128', 'rc4-40'].includes(String(stage.algorithm))
      )
        throw new InputError('encrypt: unsupported algorithm.')
      break
    case 'remediate': {
      const profile = stage.profile
      const values = typeof profile === 'string' ? [profile] : profile
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > 2 ||
        values.some((entry) => typeof entry !== 'string' || !profiles.has(entry))
      )
        throw new InputError(
          'remediate: choose a supported profile or compatible PDF/A + PDF/UA pair.',
        )
      if (values.length === 2) {
        const a = values.find((entry: string) => entry.startsWith('PDF/A-') || entry === 'Factur-X')
        const ua = values.find((entry: string) => entry.startsWith('PDF/UA-'))
        if (!a || !ua || ua !== (a.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1'))
          throw new InputError('remediate: incompatible PDF/A and PDF/UA profiles.')
      }
      // Gotenberg resolves the named asset and reads its XML contents. Unlike
      // input PDFs, invoice assets do not need a particular filename suffix.
      if (stage.xml) requiredText(stage, 'xml')
      if ((stage.xml || stage.level || stage.documentType) && !values.includes('Factur-X'))
        throw new InputError('remediate: Factur-X options need a Factur-X profile.')
      if ((stage.level || stage.documentType) && !stage.xml)
        throw new InputError('remediate: level/documentType require an XML upload.')
      if (stage.xml && !facturXLevels.has(stage.level as string))
        throw new InputError('remediate: specify a supported Factur-X level for the invoice XML.')
      break
    }
    case 'decrypt':
      // Upstream permits an empty/missing password for owner-password-only PDFs.
      if (stage.password !== undefined && typeof stage.password !== 'string') {
        throw new InputError('decrypt: "password" must be a string (empty is allowed).')
      }
      break
    case 'sign': {
      requiredText(stage, 'certificate')
      // Empty key requests PKCS#12 signing, just like an omitted key.
      if (stage.key !== undefined && stage.key !== '') requiredText(stage, 'key')
      break
    }
    case 'timestamp':
      requiredText(stage, 'timestampUrl')
      break
    case 'render':
      if (stage.format !== undefined && !['', 'png', 'jpeg'].includes(String(stage.format)))
        throw new InputError('render: format must be png or jpeg.')
      if (
        stage.quality !== undefined &&
        (stage.format !== 'jpeg' || !integer(stage.quality, 1, 100))
      )
        throw new InputError('render: JPEG quality must be between 1 and 100.')
      break
  }
  if ((name === 'sign' || name === 'timestamp') && stage.timestampUrl !== undefined) {
    if (typeof stage.timestampUrl !== 'string')
      throw new InputError(`${name}: invalid timestamp authority URL.`)
    stage.timestampUrl = timestampAuthorityUrl(stage.timestampUrl)
  }
}

const PDF_STAGE_FILE_FIELDS = ['source', 'image', 'file', 'certificate', 'key', 'xml'] as const

/** Compose sources name the current documents, not separately uploaded stage assets. */
const stageFileReferences = (stage: PdfPipelineStage): string[] =>
  PDF_STAGE_FILE_FIELDS.filter((key) => key !== 'source' || stage.op !== 'compose')
    .map((key) => stage[key])
    .filter((value): value is string => typeof value === 'string' && value !== '')

/** Gotenberg NFC-normalises uploaded/archived filenames before resolving stages.
 * Canonicalise only file references, never user-facing text or embedded names.
 */
export function normalizePdfStageAssets<T extends object>(stages: readonly T[]): T[] {
  return stages.map((stage) => {
    const normalized = { ...stage } as Record<string, unknown>
    for (const key of PDF_STAGE_FILE_FIELDS) {
      const name = normalized[key]
      if (typeof name === 'string') normalized[key] = name.normalize('NFC')
    }
    if (normalized.op === 'compose' && Array.isArray(normalized.placements)) {
      normalized.placements = normalized.placements.map((placement: unknown) => {
        if (!object(placement) || typeof placement.source !== 'string') return placement
        return { ...placement, source: placement.source.normalize('NFC') }
      })
    }
    return normalized as T
  })
}

/** Files resolved by Gotenberg, whether uploaded individually or extracted from archives. */
export function pdfStageAssetNames(stages: readonly PdfPipelineStage[]): string[] {
  return [...new Set(stages.flatMap(stageFileReferences))]
}

export type PdfPipelineValidation = {
  assetNames?: readonly string[]
  /** An unnamed remote download may supply a stage asset; Gotenberg checks its actual filename. */
  allowUnresolvedAssets?: boolean
  acknowledgedRedaction?: boolean
}

/** Parse user JSON, validate ordered stage semantics and (on server) file references. */
export function parsePdfPipeline(
  raw: string,
  context: PdfPipelineValidation = {},
): PdfPipelineStage[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new InputError('The PDF pipeline must be valid JSON.')
  }
  if (!Array.isArray(decoded) || decoded.length < 1)
    throw new InputError('Add at least one ordered PDF processing stage.')
  const stages: PdfPipelineStage[] = []
  const counts = new Map<string, number>()
  let hasDecryption = false
  let hasSigning = false
  let hasEncryption = false
  let hasPdfa = false
  let seenFinal = ''
  for (const [index, value] of decoded.entries()) {
    if (!object(value) || typeof value.op !== 'string' || !pipelineByOp.has(value.op))
      throw new InputError(`Stage ${index + 1} must select a supported PDF operation.`)
    const stage = normalizePdfStageAssets([value as PdfPipelineStage])[0] as PdfPipelineStage
    validateStage(stage)
    const op = stage.op
    const previous = counts.get(op) ?? 0
    if (previous && ['remediate', 'encrypt', 'sign', 'timestamp'].includes(op))
      throw new InputError(`Only one ${op} stage is allowed.`)
    counts.set(op, previous + 1)
    if (op === 'decrypt') {
      if (index !== 0) throw new InputError('Decryption must be the first stage.')
      hasDecryption = true
    }
    if (
      ['render', 'extract-attachments', 'extract-text'].includes(op) &&
      index !== decoded.length - 1
    )
      throw new InputError(`${op} must be the last stage.`)
    if (
      seenFinal === 'remediate' &&
      ![
        'encrypt',
        'optimize',
        'sign',
        'timestamp',
        'render',
        'extract-attachments',
        'extract-text',
      ].includes(op)
    )
      throw new InputError(`Stage ${index + 1} cannot follow remediation.`)
    if (
      seenFinal === 'encrypt' &&
      !['optimize', 'render', 'extract-attachments', 'extract-text'].includes(op)
    )
      throw new InputError(`Stage ${index + 1} cannot follow encryption.`)
    if (
      seenFinal === 'sign' &&
      !['sign', 'timestamp', 'render', 'extract-attachments', 'extract-text'].includes(op)
    )
      throw new InputError(`Stage ${index + 1} cannot follow digital signing.`)
    if (op === 'remediate') {
      hasPdfa = true
      seenFinal = 'remediate'
    }
    if (op === 'encrypt') {
      hasEncryption = true
      seenFinal = 'encrypt'
    }
    if (op === 'sign' || op === 'timestamp') {
      hasSigning = true
      if (seenFinal !== 'sign') seenFinal = 'sign'
    }
    if (context.assetNames) {
      const assetNames = new Set(context.assetNames.map((name) => name.normalize('NFC')))
      for (const key of PDF_STAGE_FILE_FIELDS) {
        if (op === 'compose' && key === 'source') continue
        if (
          typeof stage[key] === 'string' &&
          stage[key] !== '' &&
          !assetNames.has(stage[key]) &&
          !context.allowUnresolvedAssets
        ) {
          throw new InputError(
            `${op}: upload an additional file named "${stage[key]}" for "${key}".`,
          )
        }
      }
    }
    if (op === 'redact' && !context.acknowledgedRedaction)
      throw new InputError(
        'Confirm that redaction permanently removes content before running the pipeline.',
      )
    stages.push(stage)
  }
  if (hasDecryption && hasSigning)
    throw new InputError('Decrypting and signing must be separate requests.')
  if (hasEncryption && hasSigning)
    throw new InputError('Encrypting and signing cannot be combined.')
  if (
    hasPdfa &&
    hasEncryption &&
    stages.some(
      (stage) =>
        stage.op === 'remediate' &&
        (Array.isArray(stage.profile) ? stage.profile : [stage.profile]).some(
          (profile) =>
            typeof profile === 'string' && (profile.startsWith('PDF/A') || profile === 'Factur-X'),
        ),
    )
  )
    throw new InputError('PDF/A and Factur-X documents cannot be encrypted in the same pipeline.')
  return stages
}

/** Narrow accepted response media types to the actual stages requested. */
export function pipelineResponseTypes(stages: readonly PdfPipelineStage[]): readonly string[] {
  const render = stages.at(-1)
  if (render?.op === 'render')
    return stages.length === 1
      ? [render.format === 'jpeg' ? 'image/jpeg' : 'image/png', 'application/zip']
      : ['application/zip']
  // A sole extraction returns extracted files only; combined stages also return
  // the processed PDF(s) alongside the extracted files, always as a ZIP.
  if (render?.op === 'extract-text')
    return stages.length === 1 ? ['text/plain', 'application/zip'] : ['application/zip']
  if (render?.op === 'extract-attachments')
    return stages.length === 1 ? ['*', 'application/zip'] : ['application/zip']
  // Merge collapses all current documents into exactly one. Subsequent edits
  // preserve that document count; only a later split can produce a ZIP again.
  // The final read operations above are different: they add rendered/extracted
  // files alongside the PDF even after a merge.
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i]?.op === 'merge' || stages[i]?.op === 'compose') return ['application/pdf']
    if (stages[i]?.op === 'split') break
  }
  return ['application/pdf', 'application/zip']
}

/** Do not echo secrets in the visual preview (the upstream payload still contains them). */
export function safePipelinePreview(stages: readonly PdfPipelineStage[]): string {
  return JSON.stringify(
    stages,
    (key, value: unknown) =>
      /password|^key$/i.test(key) && typeof value === 'string' ? '••••••' : value,
    2,
  )
}
