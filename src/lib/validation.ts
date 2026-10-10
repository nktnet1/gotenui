import * as v from 'valibot'
import { OPERATION_BY_ID, type Operation } from './operations.ts'

const fieldValue = v.union([v.string(), v.boolean()])
const advancedValue = v.union([v.string(), v.boolean(), v.number()])

export const payloadSchema = v.object({
  operation: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  fields: v.record(v.string(), fieldValue),
  advanced: v.record(v.string(), advancedValue),
  source: v.optional(v.pipe(v.string(), v.maxLength(300_000))),
  outputName: v.optional(v.pipe(v.string(), v.maxLength(100))),
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

export function validateFiles(
  operation: Operation,
  files: File[],
  auxiliary: File[],
  maxBytes: number,
): void {
  const minFiles = operation.input === 'pdf' && operation.id === 'merge' ? 2 : 1
  if (operation.input === 'pdf' || operation.input === 'office') {
    if (files.length < minFiles || files.length > 20) {
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
  if (operation.auxiliary?.required && auxiliary.length === 0) {
    throw new InputError(`${operation.auxiliary.label} is required.`)
  }
  const names = new Set(
    operation.input === 'html'
      ? ['index.html']
      : operation.input === 'markdown'
        ? ['index.html', 'document.md']
        : [],
  )
  let total = 0
  for (const file of [...files, ...auxiliary]) {
    const name = safeFilename(file.name)
    if (names.has(name.toLowerCase())) throw new InputError(`Duplicate filename: ${name}`)
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
  return { payload, operation }
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
