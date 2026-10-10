import * as v from 'valibot'
import {
  DEFAULT_MARKDOWN_NAME,
  defaultMarkdownTemplate,
  markdownTemplateReferences,
} from '#/lib/chromium-documents'
import { OPERATION_BY_ID, type Operation } from '#/lib/operations'

const fieldValue = v.union([v.string(), v.boolean()])
const advancedValue = v.union([v.string(), v.boolean(), v.number()])
const markdownFileSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(155)),
  content: v.pipe(v.string(), v.maxLength(300_000)),
})

const remoteFileSchema = v.object({
  url: v.pipe(v.string(), v.maxLength(2048)),
  field: v.optional(v.picklist(['embedded', 'watermark', 'stamp'])),
  embedded: v.optional(v.boolean()),
  extraHttpHeaders: v.optional(v.record(v.string(), v.string())),
})

const webhookSchema = v.object({
  url: v.pipe(v.string(), v.maxLength(2048)),
  method: v.optional(v.picklist(['POST', 'PUT', 'PATCH'])),
  errorUrl: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  errorMethod: v.optional(v.picklist(['POST', 'PUT', 'PATCH'])),
  eventsUrl: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  extraHttpHeaders: v.optional(v.record(v.string(), v.string())),
})

export type RemoteFile = v.InferOutput<typeof remoteFileSchema>
export type WebhookConfig = v.InferOutput<typeof webhookSchema>

export const payloadSchema = v.object({
  operation: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  fields: v.record(v.string(), fieldValue),
  advanced: v.record(v.string(), advancedValue),
  source: v.optional(v.pipe(v.string(), v.maxLength(300_000))),
  markdownName: v.optional(v.pipe(v.string(), v.maxLength(155))),
  markdownFiles: v.optional(v.pipe(v.array(markdownFileSchema), v.maxLength(19))),
  markdownTemplate: v.optional(v.pipe(v.string(), v.maxLength(150_000))),
  headerHtml: v.optional(v.pipe(v.string(), v.maxLength(50_000))),
  footerHtml: v.optional(v.pipe(v.string(), v.maxLength(50_000))),
  outputName: v.optional(v.pipe(v.string(), v.maxLength(100))),
  requestTrace: v.optional(v.pipe(v.string(), v.maxLength(128))),
  traceparent: v.optional(v.pipe(v.string(), v.maxLength(55))),
  tracestate: v.optional(v.pipe(v.string(), v.maxLength(512))),
  downloadFrom: v.optional(v.pipe(v.array(remoteFileSchema), v.maxLength(20))),
  webhook: v.optional(webhookSchema),
})

export type ConversionPayload = v.InferOutput<typeof payloadSchema>

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
const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]{0,150}$/
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
])
const officeExtensions = new Set([
  '.doc',
  '.docx',
  '.docm',
  '.odt',
  '.rtf',
  '.txt',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.ods',
  '.csv',
  '.ppt',
  '.pptx',
  '.pptm',
  '.odp',
  '.pps',
  '.pages',
  '.numbers',
  '.key',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.tif',
  '.tiff',
  '.bmp',
  '.html',
  '.htm',
  '.epub',
  '.pdf',
  '.odg',
  '.vsdx',
  '.xml',
])

export function safeFilename(name: string): string {
  if (!filenamePattern.test(name) || name === '.' || name === '..') {
    throw new InputError('File names must be simple names without paths or special characters.')
  }
  return name
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
      markdownName(payload.markdownName ?? DEFAULT_MARKDOWN_NAME),
      ...(payload.markdownFiles ?? []).map((file) => markdownName(file.name)),
    ]
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      throw new InputError('Markdown filenames must be unique (case-insensitive).')
    }
    for (const file of payload.markdownFiles ?? []) {
      if (!file.content.trim()) throw new InputError(`${file.name} has no Markdown content.`)
    }
    const template = payload.markdownTemplate ?? defaultMarkdownTemplate(names)
    if (!template.trim()) throw new InputError('The Markdown template must not be empty.')
    const references = markdownTemplateReferences(template)
    if (!references.length) {
      throw new InputError('The Markdown template must contain {{ toHTML "file.md" }} calls.')
    }
    const included = new Set(references)
    for (const reference of references) {
      if (!names.includes(reference)) {
        throw new InputError(`Markdown template references missing file: ${reference}`)
      }
    }
    for (const name of names) {
      if (!included.has(name)) throw new InputError(`Markdown template does not render ${name}.`)
    }
  }

  const pdf =
    operation.id === 'url-pdf' || operation.id === 'html-pdf' || operation.id === 'markdown-pdf'
  if (!pdf && (payload.headerHtml !== undefined || payload.footerHtml !== undefined)) {
    throw new InputError('Custom headers and footers are supported only for Chromium PDF output.')
  }
  for (const [name, html] of [
    ['Header', payload.headerHtml],
    ['Footer', payload.footerHtml],
  ] as const) {
    if (html === undefined) continue
    if (
      !html.trim() ||
      !/<html\b[^>]*>/i.test(html) ||
      !/<\/html\s*>/i.test(html) ||
      !/<head\b[^>]*>/i.test(html) ||
      !/<\/head\s*>/i.test(html) ||
      !/<body\b[^>]*>/i.test(html) ||
      !/<\/body\s*>/i.test(html)
    ) {
      throw new InputError(`${name} must be a complete HTML document with html, head and body.`)
    }
  }
}

/** Validate outbound URL and per-request header metadata without fetching remote content here. */
function requireHttpUrl(url: string, label: string): void {
  if (!isHttpUrl(url)) throw new InputError(`${label} must be an absolute http or https URL.`)
}

function validateHeaderMap(headers: Record<string, string> | undefined): void {
  if (!headers) return
  const entries = Object.entries(headers)
  if (entries.length > 20) throw new InputError('At most 20 extra HTTP headers are supported.')
  for (const [name, value] of entries) {
    if (
      !/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(name) ||
      !value ||
      value.length > 2000 ||
      /[\r\n]/.test(value)
    ) {
      throw new InputError('Invalid extra HTTP header name or value.')
    }
  }
}

function validateAsyncInputs(payload: ConversionPayload): void {
  for (const remote of payload.downloadFrom ?? []) {
    requireHttpUrl(remote.url, 'downloadFrom URL')
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
  >,
): void {
  const remote = remoteCounts(payload)
  const minFiles = operation.input === 'pdf' && operation.id === 'merge' ? 2 : 1
  if (operation.input === 'pdf' || operation.input === 'office') {
    if (files.length + remote.input < minFiles || files.length + remote.input > 20) {
      throw new InputError(`Upload ${minFiles} to 20 input files.`)
    }
  } else if (files.length > 0) {
    throw new InputError('This operation takes source text or a URL, not input documents.')
  }
  if (!operation.auxiliary && auxiliary.length > 0) {
    // HTML/Markdown assets are auxiliary uploads, with a different field name.
    if (operation.input !== 'html' && operation.input !== 'markdown') {
      throw new InputError('Additional files are not supported for this operation.')
    }
  }
  const maxAux =
    operation.input === 'html' || operation.input === 'markdown'
      ? 20
      : operation.auxiliary?.multiple
        ? 20
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
      names.add((payload?.markdownName ?? DEFAULT_MARKDOWN_NAME).toLowerCase())
      for (const file of payload?.markdownFiles ?? []) names.add(file.name.toLowerCase())
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
  for (const file of [...files, ...auxiliary]) {
    const name = safeFilename(file.name)
    if (operation.input === 'markdown' && auxiliary.includes(file) && /\.md$/i.test(name)) {
      throw new InputError(
        'Add Markdown documents through the Markdown sources editor, not assets.',
      )
    }
    if (names.has(name.toLowerCase()) && operation.id !== 'merge') {
      throw new InputError(`Duplicate filename: ${name}`)
    }
    names.add(name.toLowerCase())
    total += file.size
    if (file.size === 0) throw new InputError(`${name} is empty.`)
    if (total > maxBytes)
      throw new InputError('Combined uploaded files exceed the configured size limit.', 413)
    const ext = name.match(extension)?.[0]?.toLowerCase()
    if (files.includes(file) && operation.input === 'pdf' && ext !== '.pdf') {
      throw new InputError('PDF tools only accept .pdf input documents.')
    }
    if (files.includes(file) && operation.input === 'office' && !officeExtensions.has(ext ?? '')) {
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
  if (operation.id === 'watermark' || operation.id === 'stamp') {
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

  const definitions = new Map(operation.fields.map((field) => [field.name, field]))
  if (Object.keys(payload.fields).length > 45 || Object.keys(payload.advanced).length > 40) {
    throw new InputError('Too many form fields.')
  }
  for (const [key, value] of Object.entries(payload.fields)) {
    const field = definitions.get(key)
    if (!field) throw new InputError(`Unsupported field: ${key}`)
    if (field.kind === 'toggle') {
      if (typeof value !== 'boolean') throw new InputError(`${field.label} must be true or false.`)
    } else {
      if (typeof value !== 'string') throw new InputError(`${field.label} must be text.`)
      if (value.length > 10000) throw new InputError(`${field.label} is too long.`)
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
          (field.max !== undefined && n > field.max)
        ) {
          throw new InputError(`${field.label} is outside its permitted range.`)
        }
      }
      if (field.kind === 'json' && value) {
        try {
          JSON.parse(value)
        } catch {
          throw new InputError(`${field.label} is not valid JSON.`)
        }
      }
    }
  }
  for (const field of operation.fields) {
    if (
      field.required &&
      (payload.fields[field.name] === '' || payload.fields[field.name] === undefined)
    ) {
      throw new InputError(`${field.label} is required.`)
    }
  }
  for (const [name, value] of Object.entries(payload.advanced)) {
    if (!fieldNamePattern.test(name) || forbiddenAdvanced.has(name) || definitions.has(name)) {
      throw new InputError(`Unsupported advanced field: ${name}`)
    }
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new InputError('Advanced values must be finite.')
    if (String(value).length > 10000) throw new InputError(`Advanced field ${name} is too long.`)
  }
  if ((operation.input === 'html' || operation.input === 'markdown') && !payload.source?.trim()) {
    throw new InputError('Enter some source content first.')
  }
  validateChromiumDocuments(operation, payload)
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
  if (payload.outputName && !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,99}$/.test(payload.outputName)) {
    throw new InputError('Output name contains invalid characters.')
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
