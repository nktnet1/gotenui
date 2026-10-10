import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import type { Operation } from '#/lib/operations'
import { downloadFilename, responseExtension } from '#/lib/security'
import {
  type ConversionPayload,
  InputError,
  validateFiles,
  validatePayload,
} from '#/lib/validation'

// The browser retains input files in memory; this is an application-side safety cap.
const maxUploadSchema = v.pipe(
  v.string(),
  v.regex(/^\d+$/),
  v.transform(Number),
  v.integer(),
  v.minValue(1),
  v.maxValue(200_000_000),
)
export const MAX_UPLOAD_BYTES = v.parse(
  maxUploadSchema,
  import.meta.env?.VITE_GOTENUI_MAX_UPLOAD_BYTES ?? '4000000',
)
export const REQUEST_TIMEOUT_MS = 180_000

const backendSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2048))
const serverStatusSchema = v.object({
  online: v.boolean(),
  version: v.string(),
  modules: v.array(v.object({ name: v.string(), status: v.string() })),
  error: v.optional(v.string()),
})

export function validatedBackend(input: string): string {
  const parsed = v.safeParse(backendSchema, input)
  if (!parsed.success) throw new InputError('Enter a valid Gotenberg URL.')
  return normalizeBackendUrl(parsed.output)
}

export type ServerStatus = {
  online: boolean
  version: string
  modules: { name: string; status: string }[]
  error?: string
}

function connectionHint(): string {
  return 'Could not reach the Gotenui API proxy. Check that TanStack Start is deployed with Nitro server functions.'
}

/** A selected connection is supplied on each request; no server session is involved. */
function targetHeaders(connection: string | ConnectionChoice): Headers {
  const headers = new Headers()
  if (typeof connection === 'string') {
    headers.set('X-Gotenberg-Url', validatedBackend(connection))
  } else if (connection.kind === 'browser') {
    headers.set('X-Gotenberg-Url', validatedBackend(connection.url))
    if (connection.authorization) {
      headers.set('X-Gotenui-Upstream-Authorization', connection.authorization)
    }
  } else {
    headers.set('X-Gotenui-Connection-Id', connection.id)
    if (connection.accessKey) headers.set('X-Gotenui-Profile-Access-Key', connection.accessKey)
  }
  return headers
}

/** Use the same target selection for full GET status and lightweight HEAD probes. */
function statusTarget(connection: string | ConnectionChoice): {
  headers: Headers
  params: URLSearchParams
} {
  const headers = targetHeaders(connection)
  const params = new URLSearchParams()
  if (headers.has('X-Gotenui-Connection-Id')) {
    params.set('connection', headers.get('X-Gotenui-Connection-Id') ?? '')
    headers.delete('X-Gotenui-Connection-Id')
  } else {
    params.set('url', headers.get('X-Gotenberg-Url') ?? '')
    headers.delete('X-Gotenberg-Url')
  }
  return { headers, params }
}

/** The browser contacts only the same-origin Gotenui endpoint. */
export async function getGotenbergStatus(
  connection: string | ConnectionChoice,
  signal?: AbortSignal,
): Promise<ServerStatus> {
  const { headers, params } = statusTarget(connection)
  try {
    const response = await fetch(`/api/gotenberg/status?${params}`, {
      headers,
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) {
      return {
        online: false,
        version: 'Unavailable',
        modules: [],
        error:
          (await response.text()).trim().slice(0, 1_500) ||
          `Proxy returned HTTP ${response.status}.`,
      }
    }
    const parsed = v.safeParse(serverStatusSchema, await response.json())
    if (!parsed.success) throw new Error('The API did not return a valid Gotenberg status.')
    return parsed.output
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      online: false,
      version: 'Unavailable',
      modules: [],
      error:
        error instanceof Error && error.message !== 'Failed to fetch'
          ? error.message
          : connectionHint(),
    }
  }
}

/** Probe HEAD /health without a response body; 503 means unhealthy, not a network failure. */
export async function probeGotenbergHealth(
  connection: string | ConnectionChoice,
  signal?: AbortSignal,
): Promise<boolean> {
  const { headers, params } = statusTarget(connection)
  let response: Response
  try {
    response = await fetch(`/api/gotenberg/health?${params}`, {
      method: 'HEAD',
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(connectionHint())
  }
  if (
    (response.status === 200 || response.status === 503) &&
    response.headers.get('x-gotenui-health-probe') !== '1'
  ) {
    throw new Error('Health probe did not reach the Gotenui API. Check the Nitro deployment.')
  }
  if (response.status === 200) return true
  if (response.status === 503) return false
  throw new Error(`Health probe returned HTTP ${response.status}. Check the selected connection.`)
}

/** Rebuild the exact Gotenberg multipart form after server-side validation. */
export function createGotenbergForm(
  operation: Operation,
  payload: ConversionPayload,
  files: File[],
  auxiliary: File[],
  maxBytes = MAX_UPLOAD_BYTES,
): FormData {
  validateFiles(operation, files, auxiliary, maxBytes, payload)
  const form = new FormData()
  for (const [key, value] of Object.entries({ ...payload.fields, ...payload.advanced })) {
    if (value !== '') form.set(key, String(value))
  }
  if (payload.downloadFrom?.length) form.set('downloadFrom', JSON.stringify(payload.downloadFrom))
  if (operation.input === 'html' || operation.input === 'markdown') {
    const html =
      operation.input === 'html'
        ? (payload.source ?? '')
        : '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Markdown</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:820px;padding:0 24px}</style></head><body>{{ toHTML "document.md" }}</body></html>'
    form.append('files', new File([html], 'index.html', { type: 'text/html' }))
    if (operation.input === 'markdown') {
      form.append(
        'files',
        new File([payload.source ?? ''], 'document.md', { type: 'text/markdown' }),
      )
    }
    for (const file of auxiliary) form.append('files', file, file.name)
  } else {
    for (const file of files) form.append('files', file, file.name)
    if (operation.auxiliary) {
      for (const file of auxiliary) form.append(operation.auxiliary.name, file, file.name)
    }
  }
  return form
}

export type ConversionResult =
  | { mode: 'download'; blob: Blob; type: string; name: string; trace?: string }
  | { mode: 'webhook'; trace?: string }

/** The proxy revalidates the JSON and files, and reconstructs a safe Gotenberg form. */
export async function convertWithGotenberg(
  connection: string | ConnectionChoice,
  candidate: unknown,
  files: File[],
  auxiliary: File[],
  signal: AbortSignal,
): Promise<ConversionResult> {
  const headers = targetHeaders(connection)
  const { operation, payload } = validatePayload(candidate)
  // Keep fast client-side feedback; all fields and files are checked again by the server.
  validateFiles(operation, files, auxiliary, MAX_UPLOAD_BYTES, payload)
  const body = new FormData()
  body.set('payload', JSON.stringify(payload))
  for (const file of files) body.append('files', file, file.name)
  for (const file of auxiliary) body.append('auxiliary', file, file.name)
  let response: Response
  try {
    response = await fetch('/api/gotenberg/convert', {
      method: 'POST',
      body,
      signal,
      credentials: 'same-origin',
      headers,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(connectionHint())
  }
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 1_500)
    throw new Error(detail || `Gotenui proxy returned HTTP ${response.status}.`)
  }
  if (response.status === 202 || response.status === 204) {
    return { mode: 'webhook', trace: response.headers.get('Gotenberg-Trace') ?? undefined }
  }
  const blob = await response.blob()
  const type =
    response.headers.get('content-type')?.split(';')[0]?.trim() ||
    blob.type ||
    'application/octet-stream'
  const extension = responseExtension(type)
  const fallback = `${payload.outputName || operation.id}.${extension}`
  const filename = payload.outputName
    ? fallback
    : downloadFilename(response.headers.get('content-disposition'), fallback)
  return {
    mode: 'download',
    blob,
    type,
    name: filename,
    trace: response.headers.get('Gotenberg-Trace') ?? undefined,
  }
}

/** Sensitive diagnostics are requested explicitly; neither the admin key nor JSON is persisted. */
export async function getGotenbergDebug(
  connection: string | ConnectionChoice,
  debugKey: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!debugKey) throw new InputError('Enter the Gotenui debug access key.')
  const headers = targetHeaders(connection)
  headers.set('X-Gotenui-Debug-Access-Key', debugKey)
  let response: Response
  try {
    response = await fetch('/api/gotenberg/debug', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(connectionHint())
  }
  if (!response.ok) {
    throw new Error(
      (await response.text()).trim().slice(0, 500) || `Debug returned HTTP ${response.status}.`,
    )
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new Error('Debug did not return JSON. Check the Gotenui API deployment.')
  }
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Debug returned an unexpected response.')
  }
  return data as Record<string, unknown>
}

/** Request bounded, admin-only legacy Prometheus metrics from the selected instance. */
export async function getGotenbergMetrics(
  connection: string | ConnectionChoice,
  adminKey: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!adminKey) throw new InputError('Enter the Gotenui diagnostics access key.')
  const headers = targetHeaders(connection)
  headers.set('X-Gotenui-Debug-Access-Key', adminKey)
  let response: Response
  try {
    response = await fetch('/api/gotenberg/metrics', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(connectionHint())
  }
  if (!response.ok) {
    throw new Error(
      (await response.text()).trim().slice(0, 500) || `Metrics returned HTTP ${response.status}.`,
    )
  }
  if (
    response.headers.get('x-gotenui-metrics') !== '1' ||
    !response.headers.get('content-type')?.toLowerCase().startsWith('text/plain')
  ) {
    throw new Error('Metrics did not reach the Gotenui API. Check the Nitro deployment.')
  }
  return response.text()
}
