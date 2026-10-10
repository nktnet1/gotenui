import type { RemoteFile, WebhookConfig } from '#/lib/validation'
import { InputError } from '#/lib/validation'

export type ExtraHeaderRow = { id: number; name: string; value: string }
export type RemoteInputRow = {
  id: number
  url: string
  field: '' | 'embedded' | 'watermark' | 'stamp'
  headers: ExtraHeaderRow[]
}
export type WebhookEditorState = {
  enabled: boolean
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  errorUrl: string
  errorMethod: 'POST' | 'PUT' | 'PATCH'
  eventsUrl: string
  headers: ExtraHeaderRow[]
}

export const emptyWebhook: WebhookEditorState = {
  enabled: false,
  url: '',
  method: 'POST',
  errorUrl: '',
  errorMethod: 'POST',
  eventsUrl: '',
  headers: [],
}

function headerMap(rows: ExtraHeaderRow[]): Record<string, string> | undefined {
  if (rows.length === 0) return undefined
  if (rows.length > 20) throw new InputError('At most 20 extra HTTP headers are supported.')
  const entries: Record<string, string> = {}
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!name || !row.value) throw new InputError('Complete every HTTP header name and value.')
    if (seen.has(name.toLowerCase())) {
      throw new InputError(`Duplicate HTTP header name: ${name}`)
    }
    seen.add(name.toLowerCase())
    entries[name] = row.value
  }
  return entries
}

function legacyJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new InputError(`${label} must be valid JSON.`)
  }
}

/** Build the existing validated API payload; do not let raw JSON silently override editor rows. */
export function remoteInputsPayload(rows: RemoteInputRow[], json: string): unknown {
  if (json.trim()) {
    if (rows.length) throw new InputError('Use remote-file rows or legacy JSON, not both.')
    return legacyJson(json, 'Remote files')
  }
  if (rows.length === 0) return undefined
  if (rows.length > 20) throw new InputError('At most 20 remote files are supported.')
  return rows.map((row): RemoteFile => {
    const headers = headerMap(row.headers)
    return {
      url: row.url.trim(),
      ...(row.field ? { field: row.field } : {}),
      ...(headers ? { extraHttpHeaders: headers } : {}),
    }
  })
}

export function webhookPayload(editor: WebhookEditorState, json: string): unknown {
  if (json.trim()) {
    if (editor.enabled) throw new InputError('Use the webhook editor or legacy JSON, not both.')
    return legacyJson(json, 'Webhook settings')
  }
  if (!editor.enabled) return undefined
  const headers = headerMap(editor.headers)
  const errorUrl = editor.errorUrl.trim()
  if (!errorUrl && !editor.eventsUrl.trim()) {
    throw new InputError('Add an events or error callback URL to receive failure details.')
  }
  return {
    url: editor.url.trim(),
    ...(editor.method !== 'POST' ? { method: editor.method } : {}),
    ...(errorUrl ? { errorUrl } : {}),
    ...(errorUrl && editor.errorMethod !== 'POST' ? { errorMethod: editor.errorMethod } : {}),
    ...(editor.eventsUrl.trim() ? { eventsUrl: editor.eventsUrl.trim() } : {}),
    ...(headers ? { extraHttpHeaders: headers } : {}),
  } satisfies WebhookConfig
}

/** A preview must never reproduce callback secrets, pre-signed URL paths/queries, or header values. */
export function safeOutboundHost(url: string): string {
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return '(invalid URL)'
    return parsed.origin
  } catch {
    return '(invalid URL)'
  }
}
