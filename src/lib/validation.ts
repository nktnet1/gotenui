import * as v from 'valibot'
import {
  ATTACHMENT_RELATIONSHIPS,
  isAttachmentMimeType,
  parseAttachmentMetadata,
} from '#/lib/attachment-metadata'
import { DEFAULT_MARKDOWN_NAME, defaultMarkdownTemplate } from '#/lib/chromium-documents'
import { encodeChromiumMediaFeatures, validateAdvancedMediaFeatures } from '#/lib/chromium-media'
import { safeFilename as checkFilename, filenameKey } from '#/lib/file-names'
import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { officeExtensionSetForMajor } from '#/lib/office-formats'
import {
  parseConsoleMessageTypes,
  parseIgnoredDomains,
  parseStatusCodes,
} from '#/lib/official-form-fields'
import { parsePdfPipeline, pdfStageAssetNames } from '#/lib/pdf-pipeline'
import {
  configuredOverlays,
  countPostProcessFiles,
  OVERLAY_KINDS,
  overlayUploads,
  PDF_POST_PROCESS_IDS,
  type PostProcessFiles,
  pdfPostProcessSchema,
} from '#/lib/pdf-post-processing'
import { metadataObject, validateBookmarkDocument } from '#/lib/pdf-structure-editors'
import { isFieldVisible, OPERATION_BY_ID, type Operation } from '#/tools/registry'

const fieldValue = v.union([v.string(), v.boolean()])
const advancedValue = v.union([v.string(), v.boolean(), v.number()])
const markdownFileSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  content: v.string(),
})

const remoteFileSchema = v.object({
  url: v.string(),
  /** Client-side filename hint for v9 named pipeline assets; never sent upstream. */
  name: v.optional(v.string()),
  field: v.optional(v.picklist(['embedded', 'watermark', 'stamp'])),
  embedded: v.optional(v.boolean()),
  extraHttpHeaders: v.optional(v.record(v.string(), v.string())),
})

const webhookSchema = v.object({
  url: v.string(),
  method: v.optional(v.picklist(['POST', 'PUT', 'PATCH'])),
  errorUrl: v.optional(v.string()),
  errorMethod: v.optional(v.picklist(['POST', 'PUT', 'PATCH'])),
  eventsUrl: v.optional(v.string()),
  extraHttpHeaders: v.optional(v.record(v.string(), v.string())),
})

export type RemoteFile = v.InferOutput<typeof remoteFileSchema>
export type WebhookConfig = v.InferOutput<typeof webhookSchema>

export const payloadSchema = v.object({
  operation: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  fields: v.record(v.string(), fieldValue),
  advanced: v.record(v.string(), advancedValue),
  source: v.optional(v.string()),
  markdownName: v.optional(v.string()),
  markdownFiles: v.optional(v.array(markdownFileSchema)),
  markdownTemplate: v.optional(v.string()),
  headerHtml: v.optional(v.string()),
  footerHtml: v.optional(v.string()),
  postProcess: v.optional(pdfPostProcessSchema),
  conversionStages: v.optional(v.pipe(v.string(), v.minLength(1))),
  acknowledgedConversionRedaction: v.optional(v.boolean()),
  outputName: v.optional(v.string()),
  requestTrace: v.optional(v.pipe(v.string(), v.maxLength(128))),
  traceparent: v.optional(v.pipe(v.string(), v.maxLength(55))),
  tracestate: v.optional(v.pipe(v.string(), v.maxLength(512))),
  downloadFrom: v.optional(v.array(remoteFileSchema)),
  webhook: v.optional(webhookSchema),
})

export type ConversionPayload = v.InferOutput<typeof payloadSchema>

/** Gotenberg 9 accepts `archives` on every multipart route, extracting files
 * into its shared workspace before identifying inputs and named stage assets.
 * The upstream version check refuses archives on Gotenberg 8.
 */
export function supportsArchiveInputs(_operation: Operation): boolean {
  return true
}

export class InputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'InputError'
  }
}

const extension = /\.[a-z0-9]+$/i
const fieldNamePattern = /^[a-z][a-zA-Z0-9]{0,63}$/
const forbiddenAdvanced = new Set([
  'files',
  'payload',
  'url',
  'downloadFrom',
  'webhookURL',
  'webhookErrorURL',
  'webhookMethod',
  'webhookErrorMethod',
  'webhookEventsURL',
  'webhookExtraHttpHeaders',
  'watermark',
  'stamp',
  'embeds',
  'facturxXml',
])

export function safeFilename(name: string): string {
  try {
    return checkFilename(name)
  } catch {
    throw new InputError('File names must not be empty, paths or contain control characters.')
  }
}

function markdownName(name: string): string {
  safeFilename(name)
  if (!/\.md$/i.test(name)) throw new InputError(`Markdown filename must end in .md: ${name}`)
  if (['index.html', 'header.html', 'footer.html'].includes(name.toLowerCase())) {
    throw new InputError(`Reserved filename: ${name}`)
  }
  return name
}

function validateChromiumDocuments(operation: Operation, payload: ConversionPayload): void {
  const isMarkdown = operation.input === 'markdown'
  if (
    !isMarkdown &&
    (payload.markdownName !== undefined ||
      payload.markdownFiles !== undefined ||
      payload.markdownTemplate !== undefined)
  ) {
    throw new InputError('Markdown documents and templates require a Markdown operation.')
  }
  if (isMarkdown) {
    const names = [
      markdownName(payload.markdownName ?? DEFAULT_MARKDOWN_NAME).normalize('NFC'),
      ...(payload.markdownFiles ?? []).map((file) => markdownName(file.name).normalize('NFC')),
    ]
    if (new Set(names.map(filenameKey)).size !== names.length) {
      throw new InputError('Markdown filenames must be unique (case-insensitive).')
    }
    const template = payload.markdownTemplate ?? defaultMarkdownTemplate(names)
    if (!template.trim()) throw new InputError('The Markdown template must not be empty.')
    // Go html/template permits static, dynamic and conditional toHTML calls.
    // Unused or conditionally missing files are valid; Gotenberg resolves
    // actual references when executing the template.
  }

  const pdf =
    operation.id === 'url-pdf' || operation.id === 'html-pdf' || operation.id === 'markdown-pdf'
  if (!pdf && (payload.headerHtml !== undefined || payload.footerHtml !== undefined)) {
    throw new InputError('Custom headers and footers are supported only for Chromium PDF output.')
  }
  // Gotenberg reads header.html and footer.html verbatim as Chromium print
  // templates. HTML fragments are valid; Chrome provides their document context.
}

/** Validate outbound URL and per-request header metadata without fetching remote content here. */
function requireHttpUrl(url: string, label: string): void {
  if (!isHttpUrl(url)) throw new InputError(`${label} must be an absolute http or https URL.`)
}

function validateHeaderMap(headers: Record<string, string> | undefined): void {
  if (!headers) return
  const entries = Object.entries(headers)
  for (const [name, value] of entries) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      [...value].some((character) => {
        const code = character.charCodeAt(0)
        return (code < 32 && code !== 9) || code === 127
      })
    ) {
      throw new InputError('Invalid extra HTTP header name or value.')
    }
  }
}

function validateAsyncInputs(payload: ConversionPayload): void {
  for (const remote of payload.downloadFrom ?? []) {
    requireHttpUrl(remote.url, 'downloadFrom URL')
    if (remote.name !== undefined) safeFilename(remote.name)
    validateHeaderMap(remote.extraHttpHeaders)
  }
  const webhook = payload.webhook
  if (webhook) {
    requireHttpUrl(webhook.url, 'Webhook URL')
    if (webhook.errorUrl) requireHttpUrl(webhook.errorUrl, 'Webhook error URL')
    if (webhook.eventsUrl) requireHttpUrl(webhook.eventsUrl, 'Webhook events URL')
    validateHeaderMap(webhook.extraHttpHeaders)
  }
}

/** Enforce the same metadata contract for /embed and conversion-time embeds. */
function validatedAttachmentMetadata(raw: string): string[] {
  const metadata = parseAttachmentMetadata(raw)
  if (!metadata)
    throw new InputError('Attachment metadata must be a JSON object of filename properties.')
  for (const [filename, details] of Object.entries(metadata)) {
    safeFilename(filename)
    if (
      (details.mimeType !== undefined && !isAttachmentMimeType(details.mimeType)) ||
      (details.relationship !== undefined &&
        !ATTACHMENT_RELATIONSHIPS.includes(details.relationship))
    ) {
      throw new InputError(`Invalid attachment metadata for ${filename}.`)
    }
  }
  return Object.keys(metadata)
}

/** Validate post-processing contracts before any upstream request is made. */
function validatePostProcessSettings(operation: Operation, payload: ConversionPayload): void {
  const settings = payload.postProcess
  if (!settings) return
  const supportsPostProcessing = PDF_POST_PROCESS_IDS.has(operation.id)
  const standalone = operation.id === 'watermark' || operation.id === 'stamp'
  if (!supportsPostProcessing && !standalone) {
    throw new InputError('PDF post-processing requires a PDF conversion, merge or split operation.')
  }
  if (standalone) {
    const permitted = operation.id === 'watermark' ? 'watermarks' : 'stamps'
    if (!settings[permitted]?.length || Object.keys(settings).some((key) => key !== permitted)) {
      throw new InputError(`The ${operation.id} tool accepts only ordered ${permitted} settings.`)
    }
  }
  for (const kind of OVERLAY_KINDS) {
    const plural = kind === 'watermark' ? 'watermarks' : 'stamps'
    if (settings[kind] && settings[plural]) {
      throw new InputError(`Choose either a single ${kind} or ordered ${plural}, not both.`)
    }
  }
  const submitted = Object.keys(settings).filter(
    (key) => settings[key as keyof typeof settings] !== undefined,
  )
  const keys = new Set<string>()
  for (const key of submitted) {
    if (['watermark', 'stamp', 'watermarks', 'stamps'].includes(key)) {
      const kind = key.startsWith('watermark') ? 'watermark' : 'stamp'
      for (const suffix of ['Source', 'Expression', 'Pages', 'Options'])
        keys.add(`${kind}${suffix}`)
    } else keys.add(key)
  }
  for (const key of keys) {
    if (payload.advanced[key] !== undefined || payload.fields[key] !== undefined) {
      throw new InputError(`Use the post-processing editor or Advanced JSON for ${key}, not both.`)
    }
  }
  const pdfa = payload.fields.pdfa ?? payload.advanced.pdfa
  if (settings.facturxConformanceLevel && pdfa && pdfa !== 'PDF/A-3b') {
    throw new InputError('Factur-X requires PDF/A-3; choose PDF/A-3b or leave PDF/A unset.')
  }
  if (
    (settings.facturxDocumentType || settings.facturxVersion) &&
    !settings.facturxConformanceLevel
  ) {
    throw new InputError('Factur-X document type and version require a conformance level.')
  }
  if (
    Object.entries(settings).some(([key, value]) => key.startsWith('allow') && value === false) &&
    !settings.userPassword &&
    !settings.ownerPassword
  ) {
    throw new InputError('PDF permissions require a user or owner password.')
  }
  if (settings.rotatePages && !settings.rotateAngle) {
    throw new InputError('Choose a rotation angle before selecting pages to rotate.')
  }
  if (
    settings.rotatePages &&
    !/^\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*$/.test(settings.rotatePages)
  ) {
    throw new InputError('Rotation pages must be page numbers or ranges, e.g. 1-3, 5.')
  }
  for (const kind of OVERLAY_KINDS) {
    for (const [index, overlay] of configuredOverlays(settings, kind).entries()) {
      const label = `${kind} ${index + 1}`
      if (overlay.source === 'text' && !overlay.expression?.trim()) {
        throw new InputError(`${kind} text cannot be empty (${label}).`)
      }
      if (overlay.pages && !/^\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*$/.test(overlay.pages)) {
        throw new InputError(`${kind} pages must be page numbers or ranges, e.g. 1-3, 5.`)
      }
      if (overlay.options) requireJsonObject(overlay.options, `${label} options`)
    }
  }
  if (settings.metadata) {
    try {
      metadataObject(settings.metadata)
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'Invalid PDF metadata.')
    }
  }
  if (settings.embedsMetadata) validatedAttachmentMetadata(settings.embedsMetadata)
}

function requireJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new InputError(`${label} must be valid JSON.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InputError(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function validatePostProcessFiles(
  operation: Operation,
  payload:
    | Pick<ConversionPayload, 'postProcess' | 'fields' | 'advanced' | 'downloadFrom'>
    | undefined,
  files: PostProcessFiles,
  maxBytes: number,
  currentBytes: number,
): void {
  const settings = payload?.postProcess
  if (
    !settings &&
    (overlayUploads(files, 'watermark').length ||
      overlayUploads(files, 'stamp').length ||
      files.facturxXml)
  ) {
    throw new InputError('Overlay and Factur-X uploads require post-processing settings.')
  }
  const standalone = operation.id === 'watermark' || operation.id === 'stamp'
  if (!PDF_POST_PROCESS_IDS.has(operation.id) && !standalone && countPostProcessFiles(files)) {
    throw new InputError('PDF processing files require a PDF conversion, merge or split operation.')
  }
  const remote = remoteCounts(payload)
  const embedded = files.embeds ?? []
  if (standalone && (embedded.length || files.facturxXml)) {
    throw new InputError('Standalone overlays cannot embed files or add Factur-X XML.')
  }
  const postFiles = [
    ...overlayUploads(files, 'watermark'),
    ...overlayUploads(files, 'stamp'),
    ...embedded,
    files.facturxXml,
  ].filter((file): file is File => file !== undefined)
  let total = currentBytes
  const embeddedNames = new Set<string>()
  for (const file of postFiles) {
    const name = safeFilename(file.name)
    if (!file.size && !embedded.includes(file)) throw new InputError(`${name} is empty.`)
    total += file.size
    if (total > maxBytes)
      throw new InputError('Combined uploaded files exceed the configured size limit.', 413)
  }
  for (const file of embedded) {
    const lower = file.name.toLowerCase()
    if (embeddedNames.has(lower))
      throw new InputError(`Duplicate PDF attachment filename: ${file.name}`)
    embeddedNames.add(lower)
  }
  if (settings?.embedsMetadata) {
    if (!embedded.length && !remote.embedded)
      throw new InputError('Attachment metadata needs an embedded file.')
    const entries = validatedAttachmentMetadata(settings.embedsMetadata)
    if (!remote.embedded && entries.some((name) => !embedded.some((file) => file.name === name))) {
      throw new InputError(
        'Attachment metadata references a file that was not uploaded (exact filename required).',
      )
    }
  }
  if (
    (embedded.length || remote.embedded) &&
    ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-4'].includes(
      String(payload?.fields.pdfa ?? payload?.advanced.pdfa),
    )
  ) {
    throw new InputError('Only PDF/A-3 supports embedded attachments. Use PDF/A-3b.')
  }
  const allNames = new Set<string>()
  for (const kind of OVERLAY_KINDS) {
    const uploads = overlayUploads(files, kind)
    const rows = settings ? configuredOverlays(settings, kind) : []
    const remoteCount = remote[kind]
    if (!rows.length) {
      if (uploads.length) throw new InputError(`${kind} upload requires ${kind} settings.`)
      // Only the original standalone tools may use a remote auxiliary file without
      // a postProcess group. Do not silently download unused overlay assets.
      if (remoteCount && !(standalone && operation.id === kind && !settings)) {
        throw new InputError(`${kind} downloadFrom requires matching ${kind} settings.`)
      }
      continue
    }
    const expectedFiles = rows.filter((row) => row.source !== 'text').length
    if (uploads.length + remoteCount !== expectedFiles) {
      if (rows.every((row) => row.source === 'text')) {
        throw new InputError(`Text ${kind} must not include an image or PDF upload.`)
      }
      throw new InputError(
        `Provide exactly one local or remote ${kind} file per image/PDF overlay.`,
      )
    }
    const localByName = new Map<string, File>()
    const localCaseFolded = new Set<string>()
    for (const file of uploads) {
      const key = file.name.toLowerCase()
      if (localCaseFolded.has(key))
        throw new InputError(`Duplicate ${kind} upload filename: ${file.name}`)
      localCaseFolded.add(key)
      localByName.set(file.name, file)
    }
    const usedLocal = new Set<string>()
    let assignedRemote = 0
    let seenLocal = false
    for (const [index, overlay] of rows.entries()) {
      if (overlay.source === 'text') continue
      // One legacy v1.0.21 upload may omit the filename expression.
      const expression =
        overlay.expression?.trim() ||
        (rows.length === 1 && uploads.length === 1 && !remoteCount ? uploads[0]?.name : '')
      if (!expression) {
        throw new InputError(
          `${kind} requires the remote file's Content-Disposition filename or a local upload.`,
        )
      }
      safeFilename(expression)
      const key = expression.toLowerCase()
      if (allNames.has(key)) throw new InputError(`Duplicate overlay filename: ${expression}`)
      allNames.add(key)
      const ext = expression.match(extension)?.[0]?.toLowerCase()
      if (
        !(overlay.source === 'pdf'
          ? ext === '.pdf'
          : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff'].includes(ext ?? ''))
      ) {
        throw new InputError(`${kind} source type does not match the uploaded file extension.`)
      }
      if (localByName.has(expression)) {
        usedLocal.add(expression)
        seenLocal = true
      } else {
        if (!remoteCount && uploads.length) {
          throw new InputError(`${kind} expression must match the uploaded filename.`)
        }
        if (seenLocal) {
          throw new InputError(
            `Remote ${kind} overlays must precede local uploads because Gotenberg downloads remote assets first.`,
          )
        }
        assignedRemote++
      }
      if (assignedRemote > remoteCount) {
        throw new InputError(`No remote ${kind} downloadFrom file matches overlay ${index + 1}.`)
      }
    }
    if (usedLocal.size !== uploads.length || assignedRemote !== remoteCount) {
      throw new InputError(
        `${kind} uploaded and remote assets must each match one overlay filename.`,
      )
    }
  }
  if (files.facturxXml && !/\.xml$/i.test(files.facturxXml.name)) {
    throw new InputError('Factur-X requires an XML invoice file.')
  }
  if (Boolean(files.facturxXml) !== Boolean(settings?.facturxConformanceLevel)) {
    throw new InputError('Factur-X requires both a local XML upload and a conformance level.')
  }
  if (
    files.facturxXml &&
    ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-4'].includes(
      String(payload?.fields.pdfa ?? payload?.advanced.pdfa),
    )
  ) {
    throw new InputError('Factur-X requires PDF/A-3.')
  }
}

/** Remote files count as inputs only when they feed the corresponding Gotenberg field. */
function remoteCounts(payload: Pick<ConversionPayload, 'downloadFrom'> | undefined) {
  const counts = { input: 0, embedded: 0, watermark: 0, stamp: 0 }
  for (const remote of payload?.downloadFrom ?? []) {
    if (remote.field === 'stamp') counts.stamp++
    else if (remote.field === 'watermark') counts.watermark++
    else if (remote.field === 'embedded' || remote.embedded) counts.embedded++
    else counts.input++
  }
  return counts
}

export function validateFiles(
  operation: Operation,
  files: File[],
  auxiliary: File[],
  maxBytes: number,
  payload?: Pick<
    ConversionPayload,
    | 'downloadFrom'
    | 'fields'
    | 'source'
    | 'markdownName'
    | 'markdownFiles'
    | 'markdownTemplate'
    | 'headerHtml'
    | 'footerHtml'
    | 'postProcess'
    | 'conversionStages'
    | 'acknowledgedConversionRedaction'
    | 'advanced'
  >,
  postFiles: PostProcessFiles = {},
  stageFiles: readonly File[] = [],
  archives: readonly File[] = [],
  major?: SupportedGotenbergMajor,
): void {
  const remote = remoteCounts(payload)
  if (
    payload?.downloadFrom?.length &&
    (operation.id === 'pdf-pipeline' || payload.conversionStages)
  ) {
    const rawStages =
      operation.id === 'pdf-pipeline' ? payload.fields?.stages : payload.conversionStages
    if (typeof rawStages === 'string' && rawStages) {
      const stageAssets = new Set(
        pdfStageAssetNames(
          parsePdfPipeline(rawStages, {
            acknowledgedRedaction:
              operation.id === 'pdf-pipeline'
                ? payload.fields?.acknowledgedRedaction === true
                : payload.acknowledgedConversionRedaction,
          }),
        ),
      )
      remote.input -= payload.downloadFrom.filter(
        (file) =>
          !file.field &&
          !file.embedded &&
          file.name !== undefined &&
          stageAssets.has(file.name.normalize('NFC')),
      ).length
    }
  }
  const minFiles = operation.input === 'pdf' && operation.id === 'merge' ? 2 : 1
  if (archives.length && !supportsArchiveInputs(operation)) {
    throw new InputError('ZIP archive inputs are not supported for this operation.')
  }
  if (operation.id === 'embed' && payload?.fields.embedsMetadata) {
    const names = validatedAttachmentMetadata(String(payload.fields.embedsMetadata))
    if (!auxiliary.length && !remote.embedded) {
      throw new InputError('Attachment metadata needs an embedded file.')
    }
    if (!remote.embedded && names.some((name) => !auxiliary.some((file) => file.name === name))) {
      throw new InputError(
        'Attachment metadata references a file that was not uploaded (exact filename required).',
      )
    }
  }
  if (operation.input === 'pdf' || operation.input === 'office') {
    const documentCount = files.length + remote.input + archives.length
    // An archive can contain several source documents; validate its actual
    // directory entries in validateZipInputs after upstream version detection.
    if (documentCount < minFiles && !archives.length) {
      throw new InputError(`Upload at least ${minFiles} input file${minFiles > 1 ? 's' : ''}.`)
    }
  } else if (files.length > 0) {
    throw new InputError('This operation takes source text or a URL, not input documents.')
  }
  if (stageFiles.length && !payload?.conversionStages) {
    throw new InputError('Conversion stage files require a PDF conversion pipeline.')
  }
  if (!operation.auxiliary && auxiliary.length > 0) {
    // HTML/Markdown assets are auxiliary uploads, with a different field name.
    if (operation.input !== 'html' && operation.input !== 'markdown') {
      throw new InputError('Additional files are not supported for this operation.')
    }
  }
  const maxAux =
    operation.auxiliary?.multiple || operation.input === 'html' || operation.input === 'markdown'
      ? Number.POSITIVE_INFINITY
      : 1
  if (auxiliary.length > maxAux) throw new InputError('Too many additional files.')
  const remoteAux =
    operation.id === 'embed'
      ? remote.embedded
      : operation.id === 'watermark'
        ? remote.watermark
        : operation.id === 'stamp'
          ? remote.stamp
          : 0
  if (operation.auxiliary?.required && auxiliary.length + remoteAux === 0) {
    throw new InputError(`${operation.auxiliary.label} is required.`)
  }
  const names = new Set<string>()
  if (operation.input === 'html' || operation.input === 'markdown') {
    for (const name of ['index.html', 'header.html', 'footer.html']) names.add(name)
    if (operation.input === 'markdown') {
      names.add(filenameKey(payload?.markdownName ?? DEFAULT_MARKDOWN_NAME))
      for (const file of payload?.markdownFiles ?? []) names.add(filenameKey(file.name))
    }
  }
  const generatedTemplate =
    operation.input === 'markdown'
      ? (payload?.markdownTemplate ??
        defaultMarkdownTemplate([
          payload?.markdownName ?? DEFAULT_MARKDOWN_NAME,
          ...(payload?.markdownFiles ?? []).map((file) => file.name),
        ]))
      : ''
  // The JSON payload and local files are independently limited by the HTTP request cap;
  // include the generated files when enforcing the upstream upload budget as well.
  const generatedText = [
    payload?.source ?? '',
    ...(payload?.markdownFiles ?? []).map((file) => file.content),
    generatedTemplate,
    payload?.headerHtml ?? '',
    payload?.footerHtml ?? '',
  ]
  let total = generatedText.reduce(
    (bytes, part) => bytes + new TextEncoder().encode(part).length,
    0,
  )
  if (total > maxBytes) {
    throw new InputError('Combined document content exceeds the configured size limit.', 413)
  }
  // Gotenberg can embed a zero-byte attachment. Keep rejecting empty input
  // documents and other assets; only an explicit `attach` stage can consume an
  // empty uploaded file as meaningful output.
  const stageJson =
    operation.id === 'pdf-pipeline' ? payload?.fields?.stages : payload?.conversionStages
  const emptyAttachmentNames = new Set<string>()
  if (
    typeof stageJson === 'string' &&
    stageJson &&
    [...auxiliary, ...stageFiles].some((file) => file.size === 0)
  ) {
    for (const stage of parsePdfPipeline(stageJson, {
      acknowledgedRedaction:
        operation.id === 'pdf-pipeline'
          ? payload?.fields?.acknowledgedRedaction === true
          : payload?.acknowledgedConversionRedaction,
    })) {
      if (stage.op === 'attach' && typeof stage.file === 'string') {
        emptyAttachmentNames.add(stage.file)
      }
    }
  }
  for (const file of [...files, ...auxiliary, ...stageFiles, ...archives]) {
    const name = safeFilename(file.name)
    if (operation.input === 'markdown' && auxiliary.includes(file) && /\.md$/i.test(name)) {
      throw new InputError(
        'Add Markdown documents through the Markdown sources editor, not assets.',
      )
    }
    const allowsOrderedDuplicates =
      operation.id === 'merge' ||
      (operation.id === 'office-pdf' && payload?.fields.merge === true && files.includes(file))
    if (names.has(filenameKey(name)) && !allowsOrderedDuplicates) {
      throw new InputError(`Duplicate filename: ${name}`)
    }
    names.add(filenameKey(name))
    total += file.size
    if (
      file.size === 0 &&
      !(
        (operation.id === 'embed' && auxiliary.includes(file)) ||
        ((auxiliary.includes(file) || stageFiles.includes(file)) &&
          emptyAttachmentNames.has(name.normalize('NFC')))
      )
    ) {
      throw new InputError(`${name} is empty.`)
    }
    if (total > maxBytes)
      throw new InputError('Combined uploaded files exceed the configured size limit.', 413)
    const ext = name.match(extension)?.[0]?.toLowerCase()
    if (archives.includes(file) && ext !== '.zip') {
      throw new InputError('Archive inputs must use the .zip extension.')
    }
    if (files.includes(file) && operation.input === 'pdf' && ext !== '.pdf') {
      throw new InputError('PDF tools only accept .pdf input documents.')
    }
    if (
      files.includes(file) &&
      operation.input === 'office' &&
      !officeExtensionSetForMajor(major).has(ext ?? '')
    ) {
      throw new InputError(`Unsupported Office conversion input: ${name}`)
    }
    if (auxiliary.includes(file) && operation.id === 'factur-x' && ext !== '.xml') {
      throw new InputError('Factur-X needs an XML invoice.')
    }
    if (
      auxiliary.includes(file) &&
      ['watermark', 'stamp'].includes(operation.id) &&
      !new Set(['.pdf', '.png', '.jpeg', '.jpg', '.gif', '.webp', '.tiff']).has(ext ?? '')
    ) {
      throw new InputError('Stamp and watermark files must be images or PDFs.')
    }
  }
  if (
    (operation.id === 'watermark' || operation.id === 'stamp') &&
    payload?.postProcess &&
    auxiliary.length
  ) {
    throw new InputError('Use the ordered overlay editor instead of the legacy auxiliary upload.')
  }
  validatePostProcessFiles(operation, payload, postFiles, maxBytes, total)
  if (payload?.postProcess) {
    for (const kind of OVERLAY_KINDS) {
      const rows = configuredOverlays(payload.postProcess, kind)
      const uploads = overlayUploads(postFiles, kind)
      for (const row of rows) {
        if (row.source === 'text') continue
        const filename =
          row.expression || (rows.length === 1 && uploads.length === 1 ? uploads[0]?.name : '')
        if (filename && names.has(filenameKey(filename))) {
          throw new InputError(`Overlay filename collides with an input or asset: ${filename}`)
        }
      }
    }
  }
  if ((operation.id === 'watermark' || operation.id === 'stamp') && !payload?.postProcess) {
    const source = payload?.fields[`${operation.id}Source`]
    const expression = payload?.fields[`${operation.id}Expression`]
    if (source === 'text' && auxiliary.length + remoteAux > 0) {
      throw new InputError('A text overlay must not include an image or PDF attachment.')
    }
    if (source !== 'text' && auxiliary.length + remoteAux !== 1) {
      throw new InputError('Provide exactly one image or PDF overlay, uploaded or remote.')
    }
    if (source !== 'text' && auxiliary.length === 1 && auxiliary[0]?.name !== expression) {
      throw new InputError('Upload a source file and match its filename in the expression field.')
    }
  }
}

/** These are Chromium browser-request settings, not incoming proxy request headers. */
function validateChromiumNetworkField(name: 'cookies' | 'extraHttpHeaders', value: unknown): void {
  if (typeof value !== 'string') throw new InputError(`Chromium ${name} must be JSON text.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new InputError(`Chromium ${name} must be valid JSON.`)
  }
  if (name === 'cookies') {
    if (!Array.isArray(parsed)) {
      throw new InputError('Chromium cookies must be a JSON array.')
    }
    for (const cookie of parsed) {
      if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
        throw new InputError('Each Chromium cookie must be an object.')
      }
      const entry = cookie as Record<string, unknown>
      if (
        Object.keys(entry).some(
          (key) =>
            !['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite'].includes(key),
        )
      ) {
        throw new InputError('Unsupported Chromium cookie property.')
      }
      if (
        typeof entry.name !== 'string' ||
        !/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(entry.name) ||
        typeof entry.value !== 'string' ||
        !entry.value.trim() ||
        [...entry.value].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === ';',
        ) ||
        typeof entry.domain !== 'string' ||
        entry.domain.length > 253 ||
        !/^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
          entry.domain,
        ) ||
        (entry.path !== undefined &&
          (typeof entry.path !== 'string' ||
            !entry.path.startsWith('/') ||
            /[\r\n]/.test(entry.path))) ||
        (entry.secure !== undefined && typeof entry.secure !== 'boolean') ||
        (entry.httpOnly !== undefined && typeof entry.httpOnly !== 'boolean') ||
        (entry.sameSite !== undefined &&
          !['strict', 'lax', 'none'].includes(String(entry.sameSite).toLowerCase()))
      ) {
        throw new InputError(
          'Chromium cookie requires a valid name, value, domain and optional attributes.',
        )
      }
      if (String(entry.sameSite).toLowerCase() === 'none' && entry.secure !== true) {
        throw new InputError('SameSite=None cookies require the HTTPS-only (secure) flag.')
      }
    }
    return
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InputError('Chromium resource headers must be a JSON object.')
  }
  const entries = Object.entries(parsed)
  if (entries.length > 64) {
    throw new InputError('Chromium resource headers must contain at most 64 entries.')
  }
  const names = new Set<string>()
  for (const [key, headerValue] of entries) {
    const lower = key.toLowerCase()
    if (
      !/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(key) ||
      names.has(lower) ||
      [
        'host',
        'cookie',
        'set-cookie',
        'connection',
        'content-length',
        'transfer-encoding',
        'upgrade',
        'te',
        'trailer',
      ].includes(lower) ||
      lower.startsWith('proxy-')
    ) {
      throw new InputError('Invalid or unsafe Chromium resource header name.')
    }
    names.add(lower)
    if (typeof headerValue !== 'string' || !headerValue || /[\r\n]/.test(headerValue)) {
      throw new InputError('Invalid Chromium resource header value.')
    }
    // Gotenberg splits header values at semicolons and accepts case-insensitive
    // `scope=` tokens. It uses .NET regexp2, not JavaScript's RegExp engine:
    // syntax validity must be checked upstream so valid .NET patterns survive.
    const tokens = headerValue.split(';')
    const scopes = tokens.flatMap((token) => {
      const separator = token.indexOf('=')
      return separator >= 0 && token.slice(0, separator).trim().toLowerCase() === 'scope'
        ? [token.slice(separator + 1).replace(/\s+/g, '')]
        : []
    })
    if (scopes.length > 1) {
      throw new InputError('Chromium resource header must contain at most one URL scope.')
    }
    const scope = scopes[0]
    if (scope === undefined) {
      if (/authorization|token|secret|key|credential|auth/i.test(key)) {
        throw new InputError(
          'Authentication headers require an explicit URL scope to avoid credential disclosure.',
        )
      }
      continue
    }
    if (!tokens[0]?.trim() || !scope || new TextEncoder().encode(scope).length > 1024) {
      throw new InputError(
        'Chromium resource header scope must be a non-empty regex (max 1,024 UTF-8 bytes).',
      )
    }
    // The upstream regexp2 parser checks the pattern before any header is applied.
  }
}

function validateConversionOptions(operation: Operation, payload: ConversionPayload): void {
  const chromium = operation.path.startsWith('/forms/chromium/')
  const office = operation.id === 'office-pdf'
  const chromiumPdf = ['url-pdf', 'html-pdf', 'markdown-pdf'].includes(operation.id)
  const chromiumOnly = [
    'cookies',
    'extraHttpHeaders',
    'waitForSelector',
    'waitForExpression',
    'waitWindowStatus',
    'userAgent',
    'singlePage',
    'preferCssPageSize',
    'generateDocumentOutline',
    'failOnConsoleMessageTypes',
    'failOnHttpStatusCodes',
    'failOnResourceHttpStatusCodes',
    'ignoreResourceHttpStatusDomains',
    'failOnResourceLoadingFailed',
    'failOnConsoleExceptions',
    'skipNetworkIdleEvent',
    'skipNetworkAlmostIdleEvent',
  ]
  const chromiumPdfOnly = ['singlePage', 'preferCssPageSize', 'generateDocumentOutline']
  const officeOnly = [
    'password',
    'exportOnlyNotesPages',
    'exportNotesPages',
    'exportHiddenSlides',
    'exportPlaceholders',
    'exportBookmarks',
    'updateIndexes',
    'exportFormFields',
    'initialView',
    'initialPage',
    'magnification',
    'zoom',
    'pageLayout',
    'firstPageOnLeft',
    'displayPDFDocumentTitle',
    'openInFullScreenMode',
    'hideViewerToolbar',
    'hideViewerMenubar',
    'centerWindow',
    'resizeWindowToInitialPage',
    'hideViewerWindowControls',
    'useTransitionEffects',
    'openBookmarkLevels',
    'exportNotesInMargin',
    'allowDuplicateFieldNames',
    'convertOooTargetToPdfTarget',
    'exportLinksRelativeFsys',
    'addOriginalDocumentAsStream',
    'nativeWatermarkText',
    'nativeTiledWatermarkText',
    'nativeWatermarkColor',
    'nativeWatermarkFontName',
    'nativeWatermarkFontHeight',
    'nativeWatermarkRotateAngle',
    'merge',
    'losslessImageCompression',
    'reduceImageResolution',
    'maxImageResolution',
  ]
  for (const name of Object.keys(payload.advanced)) {
    if (
      (!chromium && chromiumOnly.includes(name)) ||
      (!chromiumPdf && chromiumPdfOnly.includes(name)) ||
      (!chromiumPdf && !office && name === 'generateTaggedPdf') ||
      (!office && officeOnly.includes(name))
    ) {
      throw new InputError(`Advanced field ${name} is not supported for ${operation.title}.`)
    }
  }
  const pdfOptimizeRoute =
    chromiumPdf || office || operation.id === 'merge' || operation.id === 'split'
  for (const name of Object.keys(payload.advanced)) {
    if (
      (name === 'optimizeImages' || name === 'imageQuality') &&
      !pdfOptimizeRoute &&
      operation.id !== 'optimize'
    ) {
      throw new InputError(`Advanced field ${name} is not supported for ${operation.title}.`)
    }
    if (
      ['splitMode', 'splitSpan', 'splitUnify'].includes(name) &&
      !office &&
      !chromiumPdf &&
      operation.id !== 'split'
    ) {
      throw new InputError(`Advanced field ${name} is not supported for ${operation.title}.`)
    }
    if (name === 'quality' && !office && !chromium) {
      throw new InputError(`Advanced field ${name} is not supported for ${operation.title}.`)
    }
  }
  if (chromium) {
    for (const name of ['cookies', 'extraHttpHeaders'] as const) {
      const value = payload.fields[name]
      if (value !== undefined && value !== '') validateChromiumNetworkField(name, value)
    }
    for (const name of [
      'waitForSelector',
      'waitForExpression',
      'waitWindowStatus',
      'userAgent',
    ] as const) {
      const value = payload.fields[name]
      if (
        typeof value === 'string' &&
        (value.trim().length === 0 ||
          (['userAgent', 'waitWindowStatus'].includes(name) && /[\r\n]/.test(value)))
      ) {
        throw new InputError(`Invalid Chromium ${name} value.`)
      }
    }
  }
  if (office) {
    if (payload.fields.exportOnlyNotesPages === true && payload.fields.exportNotesPages !== true) {
      throw new InputError('Export only notes pages requires Export slide notes pages.')
    }
    if (
      payload.fields.allowDuplicateFieldNames === true &&
      payload.fields.exportFormFields === false
    ) {
      throw new InputError('Duplicate form field names require interactive form fields.')
    }
    if (payload.fields.firstPageOnLeft === true && payload.fields.pageLayout !== '3') {
      throw new InputError('First page on left requires the two-column PDF page layout.')
    }
    if (
      payload.fields.zoom !== undefined &&
      payload.fields.zoom !== '' &&
      payload.fields.magnification !== '4'
    ) {
      throw new InputError('Custom PDF zoom requires Custom zoom magnification.')
    }
    for (const name of ['nativeWatermarkText', 'nativeTiledWatermarkText']) {
      const value = payload.fields[name]
      if (typeof value === 'string' && /[\r\n]/.test(value)) {
        throw new InputError(`Invalid ${name}: use a single line of text.`)
      }
    }
    const watermarkFont = payload.fields.nativeWatermarkFontName
    if (typeof watermarkFont === 'string' && /[\r\n]/.test(watermarkFont)) {
      throw new InputError('Invalid nativeWatermarkFontName: use a single line of text.')
    }
  }
}

export function validatePayload(input: unknown): {
  payload: ConversionPayload
  operation: Operation
} {
  const parsed = v.safeParse(payloadSchema, input)
  if (!parsed.success)
    throw new InputError(parsed.issues[0]?.message ?? 'Invalid conversion request.')
  const payload = parsed.output
  const operation = OPERATION_BY_ID.get(payload.operation)
  if (!operation) throw new InputError('Unknown Gotenberg operation.')
  if (
    payload.conversionStages !== undefined &&
    (operation.output !== 'pdf' || operation.input === 'pdf')
  ) {
    throw new InputError('Conversion-time stages require a PDF conversion tool.')
  }
  if (payload.acknowledgedConversionRedaction && !payload.conversionStages) {
    throw new InputError('Redaction acknowledgement requires conversion-time stages.')
  }

  const definitions = new Map(operation.fields.map((field) => [field.name, field]))
  for (const [key, value] of Object.entries(payload.fields)) {
    const field = definitions.get(key)
    if (!field) throw new InputError(`Unsupported field: ${key}`)
    if (field.kind === 'toggle') {
      if (typeof value !== 'boolean') throw new InputError(`${field.label} must be true or false.`)
    } else {
      if (typeof value !== 'string') throw new InputError(`${field.label} must be text.`)
      // The proxy's byte limit covers large values, including non-JSON stage text.
      if (field.kind === 'select' && value && !field.options?.includes(value)) {
        throw new InputError(`Invalid option for ${field.label}.`)
      }
      if (field.kind === 'url' && value && !isHttpUrl(value)) {
        throw new InputError('Enter an absolute http or https URL.')
      }
      if (field.kind === 'number' && value) {
        const n = Number(value)
        if (
          !Number.isFinite(n) ||
          (field.min !== undefined && n < field.min) ||
          (field.max !== undefined && n > field.max) ||
          (field.integer === true && !Number.isInteger(n))
        ) {
          throw new InputError(`${field.label} is outside its permitted range.`)
        }
      }
      if (field.kind === 'color' && value && !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new InputError(`${field.label} must be a six-digit hex colour.`)
      }
      if (field.kind === 'json' && value) {
        try {
          JSON.parse(value)
        } catch {
          throw new InputError(`${field.label} is not valid JSON.`)
        }
      }
      if (value && field.kind === 'http-codes') {
        try {
          parseStatusCodes(value)
        } catch (error) {
          throw new InputError(
            error instanceof Error ? error.message : 'Invalid HTTP status codes.',
          )
        }
      }
      if (value && field.kind === 'hostnames') {
        try {
          parseIgnoredDomains(value)
        } catch (error) {
          throw new InputError(error instanceof Error ? error.message : 'Invalid domain names.')
        }
      }
      if (value && field.kind === 'console-message-types') {
        try {
          parseConsoleMessageTypes(value)
        } catch (error) {
          throw new InputError(
            error instanceof Error ? error.message : 'Invalid console message types.',
          )
        }
      }
    }
  }
  for (const field of operation.fields) {
    const value = payload.fields[field.name]
    if (
      value !== undefined &&
      value !== '' &&
      value !== false &&
      !isFieldVisible(field, payload.fields) &&
      !(operation.id === 'split' && field.name === 'splitUnify')
    ) {
      throw new InputError(`${field.label} requires its related option to be enabled.`)
    }
  }
  const splitMode = payload.fields.splitMode
  const splitSpan = payload.fields.splitSpan
  if (splitMode !== undefined && splitMode !== '' && !String(splitSpan ?? '').trim()) {
    throw new InputError('A page range or interval is required when splitting output.')
  }
  if (
    operation.id === 'office-pdf' &&
    splitMode === 'intervals' &&
    payload.fields.splitUnify === true
  ) {
    throw new InputError('Combine selected page ranges is available only in pages mode.')
  }
  if (operation.id === 'office-pdf' && !splitMode && splitSpan) {
    throw new InputError('Choose a split mode before entering a page range or interval.')
  }
  if (
    operation.id === 'office-pdf' &&
    splitMode === 'intervals' &&
    !/^[1-9]\d*$/.test(String(splitSpan))
  ) {
    throw new InputError('Split interval must be a positive whole number.')
  }
  const metadata = payload.fields.metadata ?? payload.advanced.metadata
  if (metadata) {
    try {
      metadataObject(String(metadata))
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'Invalid PDF metadata.')
    }
  }
  if (definitions.has('bookmarks') && payload.fields.bookmarks) {
    try {
      validateBookmarkDocument(String(payload.fields.bookmarks ?? ''))
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'Invalid PDF bookmarks.')
    }
  }
  if (operation.id === 'embed' && payload.fields.embedsMetadata) {
    validatedAttachmentMetadata(String(payload.fields.embedsMetadata))
  }
  const orderedStandalone =
    (operation.id === 'watermark' && Boolean(payload.postProcess?.watermarks?.length)) ||
    (operation.id === 'stamp' && Boolean(payload.postProcess?.stamps?.length))
  for (const field of operation.fields) {
    if (
      !orderedStandalone &&
      field.required &&
      (payload.fields[field.name] === '' || payload.fields[field.name] === undefined)
    ) {
      throw new InputError(`${field.label} is required.`)
    }
  }
  if (payload.advanced.emulatedMediaFeatures !== undefined) {
    if (!operation.path.startsWith('/forms/chromium/')) {
      throw new InputError('emulatedMediaFeatures is supported only by Chromium.')
    }
    if (encodeChromiumMediaFeatures(payload.fields)) {
      throw new InputError('Choose media settings in the UI or Advanced JSON, not both.')
    }
    if (typeof payload.advanced.emulatedMediaFeatures !== 'string') {
      throw new InputError('emulatedMediaFeatures must contain JSON text.')
    }
    try {
      validateAdvancedMediaFeatures(payload.advanced.emulatedMediaFeatures)
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'Invalid media features.')
    }
  }
  for (const [name, value] of Object.entries(payload.advanced)) {
    if (!fieldNamePattern.test(name) || forbiddenAdvanced.has(name) || definitions.has(name)) {
      throw new InputError(`Unsupported advanced field: ${name}`)
    }
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new InputError('Advanced values must be finite.')
  }
  if (operation.input === 'html' && !payload.source?.trim()) {
    throw new InputError('Enter some source content first.')
  }
  validateChromiumDocuments(operation, payload)
  validateConversionOptions(operation, payload)
  validatePostProcessSettings(operation, payload)
  if (definitions.has('pdfa')) {
    const pdfa = payload.fields.pdfa ?? payload.advanced.pdfa
    const pdfua = payload.fields.pdfua ?? payload.advanced.pdfua
    const userPassword = payload.postProcess?.userPassword ?? payload.advanced.userPassword
    const ownerPassword = payload.postProcess?.ownerPassword ?? payload.advanced.ownerPassword
    if (pdfa && (userPassword || ownerPassword)) {
      throw new InputError('PDF/A and PDF encryption cannot be combined.')
    }
    if (pdfa === 'PDF/A-1b' && pdfua === true) {
      throw new InputError(
        'PDF/UA is not supported with PDF/A-1b. Use PDF/A-2b, PDF/A-3b or PDF/A-4.',
      )
    }
  }
  if (operation.id === 'encrypt' && !payload.fields.userPassword && !payload.fields.ownerPassword) {
    throw new InputError('Enter an open password or owner password.')
  }
  if (operation.id === 'pdfa' && !payload.fields.pdfa && !payload.fields.pdfua) {
    throw new InputError('Choose a PDF/A standard or enable PDF/UA.')
  }
  if (
    operation.id === 'split' &&
    payload.fields.splitMode === 'intervals' &&
    payload.fields.splitUnify === true
  ) {
    throw new InputError('Unify is supported only in pages mode.')
  }
  if (payload.outputName) {
    safeFilename(payload.outputName)
  }
  if (operation.id === 'merge' && payload.advanced.bookmarks !== undefined) {
    try {
      JSON.parse(String(payload.advanced.bookmarks))
    } catch {
      throw new InputError('Merge bookmarks must be valid JSON.')
    }
  }
  validateRequestMetadata(payload)
  validateAsyncInputs(payload)
  return { payload, operation }
}

/** Only validated request metadata is ever sent as upstream HTTP headers. */
function validateRequestMetadata(payload: ConversionPayload): void {
  if (payload.requestTrace && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payload.requestTrace)) {
    throw new InputError(
      'Gotenberg request ID must contain only letters, digits, dots, colons, underscores or hyphens.',
    )
  }
  if (payload.traceparent !== undefined) {
    if (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(payload.traceparent)) {
      throw new InputError('traceparent must use W3C version 00 with lowercase hexadecimal IDs.')
    }
    const [, traceId, spanId] = payload.traceparent.split('-')
    if (/^0+$/.test(traceId ?? '') || /^0+$/.test(spanId ?? '')) {
      throw new InputError('traceparent trace and parent span IDs must not be all zeros.')
    }
  }
  if (payload.tracestate !== undefined) {
    if (!payload.traceparent) throw new InputError('tracestate requires traceparent.')
    const members = payload.tracestate.split(',')
    if (members.length > 32 || members.length === 0) {
      throw new InputError('tracestate supports at most 32 entries.')
    }
    const keys = new Set<string>()
    for (const member of members) {
      const trimmed = member.trim()
      const separator = trimmed.indexOf('=')
      const key = trimmed.slice(0, separator)
      const value = trimmed.slice(separator + 1)
      const simpleKey = /^[a-z][a-z0-9_*/-]{0,255}$/
      const tenantKey = /^[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13}$/
      if (
        separator === -1 ||
        (!simpleKey.test(key) && !tenantKey.test(key)) ||
        value.length === 0 ||
        value.length > 256 ||
        !/^[\x20-\x2B\x2D-\x3C\x3E-\x7E]+$/.test(value) ||
        value.trim() !== value ||
        keys.has(key)
      ) {
        throw new InputError('Invalid W3C tracestate entry.')
      }
      keys.add(key)
    }
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !!url.hostname &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function parseAdvanced(text: string): Record<string, string | boolean | number> {
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new InputError('Advanced parameters must be valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Advanced parameters must be a JSON object.')
  }
  const parsed = v.safeParse(v.record(v.string(), advancedValue), value)
  if (!parsed.success) throw new InputError('Advanced values must be strings, booleans or numbers.')
  return parsed.output
}
