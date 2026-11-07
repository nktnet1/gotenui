/** Strict request mapping for the Gotenberg 9-only PDF workflows. */

import { filenameKey } from '#/lib/file-names'
import { isPdfPageSelector } from '#/lib/pdf-page-selectors'
import { normalizePdfStageAssets } from '#/lib/pdf-pipeline'
import { timestampAuthorityUrl } from '#/lib/timestamp-authority'
import { type ConversionPayload, InputError } from '#/lib/validation'
import { V9_PDF_IDS, V9_PDF_READ_ROUTES } from '#/tools/v9-pdf-config'

function jsonValue(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new InputError(`${label} must be valid JSON.`)
  }
}

function namedPages(value: string, label: string): string {
  const normalized = value.trim()
  if (!isPdfPageSelector(normalized)) {
    throw new InputError(`${label} must use page numbers, ranges, odd, even, last or all.`)
  }
  return normalized
}

function decimal(value: string | boolean | undefined, label: string): number {
  const number = typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new InputError(`${label} must be a finite number.`)
  return number
}

function validateFields(payload: ConversionPayload, allowed: readonly string[]): void {
  const names = new Set(allowed)
  for (const [name, value] of Object.entries(payload.fields)) {
    if (!names.has(name) && value !== undefined && value !== '' && value !== false) {
      throw new InputError(`Unsupported Gotenberg 9 PDF field: ${name}.`)
    }
  }
  if (Object.keys(payload.advanced).length || payload.postProcess) {
    throw new InputError(
      'These Gotenberg 9 tools accept only the documented options, not legacy advanced fields or post-processing.',
    )
  }
  if (payload.downloadFrom?.some(({ embedded, field }) => embedded || field)) {
    throw new InputError(
      'PDF inspection and processing only accept remote PDF inputs, not remote attachments.',
    )
  }
}

const validProfile = new Set([
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

/** Returns null for existing tools so their v8/v9 adapter remains untouched. */
export function adaptV9PdfExtra(
  operationId: string,
  payload: ConversionPayload,
  legacy: FormData,
  auxiliary: readonly File[],
  archives: readonly File[] = [],
): { path: string; form: FormData } | null {
  if (!V9_PDF_IDS.has(operationId)) return null
  const fields = payload.fields
  const form = new FormData()
  for (const file of legacy.getAll('files')) {
    if (!(file instanceof File)) throw new InputError('Expected PDF upload.')
    form.append('files', file, file.name)
  }
  const downloadFrom = legacy.get('downloadFrom')
  if (typeof downloadFrom === 'string') form.set('downloadFrom', downloadFrom)
  for (const archive of archives) form.append('archives', archive, archive.name)
  const stages: Record<string, unknown>[] = []
  const value = (name: string): string =>
    typeof fields[name] === 'string' ? fields[name].trim() : ''
  // Passwords are opaque strings. Never trim or treat whitespace as absent.
  const password = (name: 'password' | 'certificatePassword'): string | undefined => {
    const text = fields[name]
    return typeof text === 'string' && text !== '' ? text : undefined
  }
  const allow = (...names: string[]) => validateFields(payload, names)
  const onlyPdfInputs = () => {
    if (auxiliary.length) throw new InputError('This PDF tool does not accept additional files.')
  }
  const uploaded = new Set(
    form.getAll('files').map((entry) => (entry instanceof File ? filenameKey(entry.name) : '')),
  )
  const addAsset = (file: File): void => {
    if (uploaded.has(filenameKey(file.name))) {
      throw new InputError(`Additional file '${file.name}' collides with a PDF input filename.`)
    }
    uploaded.add(filenameKey(file.name))
    form.append('files', file, file.name)
  }
  const requirePages = (name: string) => namedPages(value(name), name)

  switch (operationId) {
    case 'extract-attachments':
      allow('name')
      onlyPdfInputs()
      if (typeof fields.name === 'string' && fields.name) form.set('name', fields.name)
      return { path: '/forms/pdf/extract-attachments', form }
    case 'extract-text':
      allow('pages', 'invisible', 'artifacts', 'annotations')
      onlyPdfInputs()
      if (value('pages')) form.set('pages', requirePages('pages'))
      for (const name of ['invisible', 'artifacts', 'annotations'] as const) {
        if (fields[name] === true) form.set(name, 'true')
      }
      return { path: '/forms/pdf/extract-text', form }
    case 'pdf-info':
    case 'pdf-attachments':
      allow('password')
      onlyPdfInputs()
      break
    case 'pdf-form':
      allow('password', 'pages')
      onlyPdfInputs()
      if (value('pages')) form.set('pages', requirePages('pages'))
      break
    case 'pdf-validate': {
      allow('password', 'profile', 'additionalProfile')
      onlyPdfInputs()
      const main = value('profile')
      const additional = value('additionalProfile')
      if (!validProfile.has(main)) throw new InputError('Choose a supported validation profile.')
      if (additional) {
        const paired = main.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1'
        if ((!main.startsWith('PDF/A-') && main !== 'Factur-X') || additional !== paired) {
          throw new InputError(
            `The additional PDF/UA profile must match the PDF/A version (${paired}).`,
          )
        }
      }
      form.append('profile', main)
      if (additional) form.append('profile', additional)
      break
    }
    case 'select-pages':
    case 'delete-pages':
      allow('pages')
      onlyPdfInputs()
      stages.push({
        op: operationId === 'select-pages' ? 'select' : 'delete',
        pages: requirePages('pages'),
      })
      break
    case 'insert-pages': {
      allow('at', 'sourcePages')
      if (auxiliary.length !== 1 || !/\.pdf$/i.test(auxiliary[0]?.name ?? '')) {
        throw new InputError('Upload exactly one additional PDF containing pages to insert.')
      }
      const at = value('at') ? decimal(fields.at, 'Insert position') : 0
      if (!Number.isSafeInteger(at) || at < 0)
        throw new InputError('Insert position must be zero or a positive whole number.')
      const asset = auxiliary[0]
      addAsset(asset)
      stages.push({
        op: 'insert',
        source: asset.name,
        at,
        ...(value('sourcePages') ? { sourcePages: requirePages('sourcePages') } : {}),
      })
      break
    }
    case 'fill-form': {
      allow('formValues')
      onlyPdfInputs()
      const data = jsonValue(value('formValues'), 'Form values')
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).length < 1
      ) {
        throw new InputError('Form values must be an object with at least one named field.')
      }
      for (const [key, field] of Object.entries(data)) {
        if (
          !key.trim() ||
          !(
            typeof field === 'string' ||
            (Array.isArray(field) && field.every((entry) => typeof entry === 'string'))
          )
        ) {
          throw new InputError(
            'Form field names must be non-empty; values must be strings or arrays of strings.',
          )
        }
      }
      stages.push({ op: 'set-form', fields: data })
      break
    }
    case 'flatten-transparency':
    case 'autotag':
      allow()
      onlyPdfInputs()
      stages.push({ op: operationId })
      break
    case 'convert-colors':
      allow('target')
      onlyPdfInputs()
      if (!['rgb', 'cmyk', 'gray', 'output-intent'].includes(value('target'))) {
        throw new InputError('Choose a supported target colour space.')
      }
      stages.push({ op: 'convert-colors', target: value('target') })
      break
    case 'redact': {
      allow('regions', 'confirmRedaction')
      onlyPdfInputs()
      if (fields.confirmRedaction !== true)
        throw new InputError('Confirm permanent redaction before submitting.')
      const regions = jsonValue(value('regions'), 'Redaction regions')
      if (!Array.isArray(regions) || regions.length < 1) {
        throw new InputError('Provide at least one redaction rectangle.')
      }
      for (const region of regions) {
        if (
          !region ||
          typeof region !== 'object' ||
          Array.isArray(region) ||
          Object.keys(region).some((key) => !['page', 'x', 'y', 'width', 'height'].includes(key)) ||
          !Number.isSafeInteger(region.page) ||
          region.page < 1 ||
          !['x', 'y', 'width', 'height'].every(
            (key) => typeof region[key] === 'number' && Number.isFinite(region[key]),
          ) ||
          region.width <= 0 ||
          region.height <= 0
        ) {
          throw new InputError(
            'Each redaction region needs a positive page number, finite coordinates and positive width and height.',
          )
        }
      }
      stages.push({ op: 'redact', regions })
      break
    }
    case 'detach': {
      allow('attachmentName')
      onlyPdfInputs()
      // Embedded attachment names are exact strings, including surrounding spaces.
      const name = fields.attachmentName
      if (typeof name !== 'string' || name === '') {
        throw new InputError('Specify the exact embedded filename.')
      }
      stages.push({ op: 'detach', name })
      break
    }
    case 'decrypt':
      allow('password')
      onlyPdfInputs()
      stages.push({
        op: 'decrypt',
        password: typeof fields.password === 'string' ? fields.password : '',
      })
      break
    case 'sign': {
      allow(
        'certificatePassword',
        'reason',
        'location',
        'contactInfo',
        'signerName',
        'pades',
        'timestampUrl',
      )
      if (auxiliary.length < 1 || auxiliary.length > 2)
        throw new InputError('Upload a PKCS#12 certificate or a PEM certificate and key.')
      // One file is a PKCS#12 store; two files are a PEM certificate and key.
      // Gotenberg selects PEM when a key is supplied, otherwise PKCS#12.
      // Neither format requires a particular filename extension.
      // Prefer an explicit .key suffix when present; otherwise use upload order.
      const namedKey =
        auxiliary.length === 2 ? auxiliary.find((file) => /\.key$/i.test(file.name)) : undefined
      const key = auxiliary.length === 2 ? (namedKey ?? auxiliary[1]) : undefined
      const certificate = auxiliary.find((file) => file !== key)
      if (!certificate) throw new InputError('Choose a signing certificate.')
      for (const file of auxiliary) addAsset(file)
      const certificatePassword = password('certificatePassword')
      stages.push({
        op: 'sign',
        certificate: certificate.name,
        ...(key ? { key: key.name } : {}),
        ...(certificatePassword !== undefined ? { certificatePassword } : {}),
        ...(value('reason') ? { reason: fields.reason } : {}),
        ...(value('location') ? { location: fields.location } : {}),
        ...(value('contactInfo') ? { contactInfo: fields.contactInfo } : {}),
        ...(value('signerName') ? { name: fields.signerName } : {}),
        ...(fields.pades === true ? { pades: true } : {}),
        ...(value('timestampUrl')
          ? { timestampUrl: timestampAuthorityUrl(fields.timestampUrl as string) }
          : {}),
      })
      break
    }
    case 'timestamp':
      allow('timestampUrl')
      onlyPdfInputs()
      stages.push({
        op: 'timestamp',
        timestampUrl: timestampAuthorityUrl(fields.timestampUrl as string),
      })
      break
    case 'render-pages': {
      allow('pages', 'format', 'dpi', 'quality')
      onlyPdfInputs()
      const format = value('format')
      if (!['png', 'jpeg'].includes(format)) throw new InputError('Choose PNG or JPEG rendering.')
      const stage: Record<string, unknown> = { op: 'render', format }
      if (value('pages')) stage.pages = requirePages('pages')
      if (value('dpi')) {
        const dpi = decimal(fields.dpi, 'Render DPI')
        if (!Number.isSafeInteger(dpi) || dpi < 1)
          throw new InputError('DPI must be a positive whole number.')
        stage.dpi = dpi
      }
      if (value('quality')) {
        const quality = decimal(fields.quality, 'JPEG quality')
        if (format !== 'jpeg' || !Number.isSafeInteger(quality) || quality < 1 || quality > 100) {
          throw new InputError('JPEG quality must be between 1 and 100 and requires JPEG output.')
        }
        stage.quality = quality
      }
      stages.push(stage)
      break
    }
    default:
      throw new InputError(`Unsupported Gotenberg 9 tool: ${operationId}.`, 409)
  }
  const route = V9_PDF_READ_ROUTES.get(operationId)
  if (route) {
    const openPassword = password('password')
    if (openPassword !== undefined) form.set('password', openPassword)
    return { path: route, form }
  }
  form.set('stages', JSON.stringify(normalizePdfStageAssets(stages)))
  return { path: '/forms/pdf/pipe', form }
}
