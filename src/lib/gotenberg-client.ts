import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'
import { DEFAULT_MARKDOWN_NAME, defaultMarkdownTemplate } from '#/lib/chromium-documents'
import { CHROMIUM_MEDIA_OPTIONS, encodeChromiumMediaFeatures } from '#/lib/chromium-media'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { mergeBookmarks, mergeUploadFilename } from '#/lib/merge-order'
import { encodeOfficialField } from '#/lib/official-form-fields'
import {
  OVERLAY_KINDS,
  orderedOverlayUploads,
  overlayUploads,
  type PostProcessFiles,
  postProcessFormFields,
} from '#/lib/pdf-post-processing'
import { downloadFilename, responseExtension } from '#/lib/security'
import {
  type ConversionPayload,
  InputError,
  validateFiles,
  validatePayload,
} from '#/lib/validation'
import type { Operation } from '#/tools/registry'

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
  import.meta.env?.PUBLIC_GOTENUI_MAX_UPLOAD_BYTES ?? '4000000',
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
  postFiles: PostProcessFiles = {},
): FormData {
  validateFiles(operation, files, auxiliary, maxBytes, payload, postFiles)
  const form = new FormData()
  const isChromium = operation.path.startsWith('/forms/chromium/')
  const mediaFieldNames = new Set<string>(CHROMIUM_MEDIA_OPTIONS.map((feature) => feature.name))
  for (const [key, value] of Object.entries({ ...payload.fields, ...payload.advanced })) {
    if (mediaFieldNames.has(key)) continue // UI-only controls are encoded as a single JSON array.

    if (value === '') continue
    // Gotenberg keys per-input bookmarks by the uploaded filename.
    const encoded =
      operation.id === 'merge' && key === 'bookmarks'
        ? mergeBookmarks(
            String(value),
            files.map((file) => file.name),
          )
        : String(value)
    form.set(
      key,
      encodeOfficialField(
        operation.fields.find((field) => field.name === key),
        encoded,
      ),
    )
  }
  if (isChromium) {
    const mediaFeatures = encodeChromiumMediaFeatures(payload.fields)
    if (mediaFeatures) form.set('emulatedMediaFeatures', mediaFeatures)
  }
  if (payload.downloadFrom?.length) form.set('downloadFrom', JSON.stringify(payload.downloadFrom))
  if (operation.input === 'html' || operation.input === 'markdown') {
    const markdownNames = [
      payload.markdownName ?? DEFAULT_MARKDOWN_NAME,
      ...(payload.markdownFiles ?? []).map((file) => file.name),
    ]
    const html =
      operation.input === 'html'
        ? (payload.source ?? '')
        : (payload.markdownTemplate ?? defaultMarkdownTemplate(markdownNames))
    form.append('files', new File([html], 'index.html', { type: 'text/html' }))
    if (operation.input === 'markdown') {
      form.append(
        'files',
        new File([payload.source ?? ''], markdownNames[0], { type: 'text/markdown' }),
      )
      for (const file of payload.markdownFiles ?? []) {
        form.append('files', new File([file.content], file.name, { type: 'text/markdown' }))
      }
    }
    for (const file of auxiliary) form.append('files', file, file.name)
  } else {
    for (const [index, file] of files.entries()) {
      const name =
        operation.id === 'merge' || (operation.id === 'office-pdf' && payload.fields.merge === true)
          ? mergeUploadFilename(file.name, index, files.length)
          : file.name
      form.append('files', file, name)
    }
    if (operation.auxiliary) {
      for (const file of auxiliary) form.append(operation.auxiliary.name, file, file.name)
    }
  }
  if (payload.headerHtml !== undefined) {
    form.append('files', new File([payload.headerHtml], 'header.html', { type: 'text/html' }))
  }
  if (payload.footerHtml !== undefined) {
    form.append('files', new File([payload.footerHtml], 'footer.html', { type: 'text/html' }))
  }
  if (payload.postProcess) {
    for (const [name, value] of postProcessFormFields(payload.postProcess, postFiles)) {
      form.append(name, value)
    }
  }
  for (const kind of OVERLAY_KINDS) {
    const uploads = payload.postProcess
      ? orderedOverlayUploads(payload.postProcess, postFiles, kind)
      : overlayUploads(postFiles, kind)
    for (const file of uploads) form.append(kind, file, file.name)
  }
  for (const file of postFiles.embeds ?? []) form.append('embeds', file, file.name)
  if (postFiles.facturxXml)
    form.append('facturxXml', postFiles.facturxXml, postFiles.facturxXml.name)
  return form
}

export type ConversionResult =
  | { mode: 'download'; blob: Blob; type: string; name: string; trace?: string }
  | { mode: 'webhook'; trace?: string; status: 202 | 204 }

/** The proxy revalidates the JSON and files, and reconstructs a safe Gotenberg form. */
export async function convertWithGotenberg(
  connection: string | ConnectionChoice,
  candidate: unknown,
  files: File[],
  auxiliary: File[],
  signal: AbortSignal,
  postFiles: PostProcessFiles = {},
): Promise<ConversionResult> {
  const headers = targetHeaders(connection)
  const { operation, payload } = validatePayload(candidate)
  // Keep fast client-side feedback; all fields and files are checked again by the server.
  validateFiles(operation, files, auxiliary, MAX_UPLOAD_BYTES, payload, postFiles)
  const body = new FormData()
  body.set('payload', JSON.stringify(payload))
  for (const file of files) body.append('files', file, file.name)
  for (const file of auxiliary) body.append('auxiliary', file, file.name)
  for (const kind of OVERLAY_KINDS) {
    for (const file of overlayUploads(postFiles, kind)) body.append(kind, file, file.name)
  }
  for (const file of postFiles.embeds ?? []) body.append('embeds', file, file.name)
  if (postFiles.facturxXml)
    body.append('facturxXml', postFiles.facturxXml, postFiles.facturxXml.name)
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
    const trace = response.headers.get('Gotenberg-Trace')?.slice(0, 128)
    const message = detail || `Gotenui proxy returned HTTP ${response.status}.`
    throw new Error(trace ? `${message} (Gotenberg trace: ${trace})` : message)
  }
  if (response.status === 202 || response.status === 204) {
    return {
      mode: 'webhook',
      trace: response.headers.get('Gotenberg-Trace') ?? undefined,
      status: response.status as 202 | 204,
    }
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

/** Read selected-instance debug JSON using its upstream authentication; no Gotenui access key. */
export async function getGotenbergDebug(
  connection: string | ConnectionChoice,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const headers = targetHeaders(connection)
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

/** Request bounded legacy Prometheus metrics; the upstream controls authentication. */
export async function getGotenbergMetricsReport(
  connection: string | ConnectionChoice,
  signal?: AbortSignal,
): Promise<{ text: string; source: 'otel' | 'legacy' }> {
  const headers = targetHeaders(connection)
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
  return {
    text: await response.text(),
    source: response.headers.get('x-gotenui-metrics-source') === 'otel' ? 'otel' : 'legacy',
  }
}

/** Preserve plain-text callers while exposing exporter provenance to diagnostics. */
export async function getGotenbergMetrics(
  connection: string | ConnectionChoice,
  signal?: AbortSignal,
): Promise<string> {
  return (await getGotenbergMetricsReport(connection, signal)).text
}
