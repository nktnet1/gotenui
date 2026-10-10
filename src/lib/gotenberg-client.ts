import urlJoin from 'url-join'
import * as v from 'valibot'
import { normalizeBackendUrl } from './backend-url.ts'
import type { Operation } from './operations.ts'
import { downloadFilename, responseExtension } from './security.ts'
import { type ConversionPayload, InputError, validateFiles, validatePayload } from './validation.ts'

// The browser retains input files in memory; this is an application-side safety cap.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const REQUEST_TIMEOUT_MS = 180_000

const backendSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2048))
const healthSchema = v.object({
  status: v.picklist(['up', 'down']),
  details: v.optional(v.record(v.string(), v.unknown())),
})

export function validatedBackend(input: string): string {
  const parsed = v.safeParse(backendSchema, input)
  if (!parsed.success) throw new InputError('Enter a valid Gotenberg URL.')
  return normalizeBackendUrl(parsed.output)
}

export function endpoint(baseUrl: string, path: string): string {
  return urlJoin(validatedBackend(baseUrl), path)
}

export type ServerStatus = {
  online: boolean
  version: string
  modules: { name: string; status: string }[]
  error?: string
}

function connectionHint(): string {
  return 'Could not reach Gotenberg from this browser. Check the URL, HTTPS/mixed content and CORS permissions, or use a same-origin reverse proxy.'
}

/** Requests are made by the browser, never by an application server. */
export async function getGotenbergStatus(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ServerStatus> {
  const url = validatedBackend(baseUrl)
  try {
    const health = await fetch(endpoint(url, '/health'), {
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    })
    if (!health.ok) {
      return {
        online: false,
        version: 'Unavailable',
        modules: [],
        error: `Gotenberg health check returned HTTP ${health.status}.`,
      }
    }
    const raw: unknown = await health.json().catch(() => null)
    const parsed = v.safeParse(healthSchema, raw)
    if (!parsed.success) {
      return {
        online: false,
        version: 'Unavailable',
        modules: [],
        error:
          'The address returned a successful response, but not a Gotenberg health check. Check the proxy path.',
      }
    }
    if (parsed.output.status !== 'up') {
      return {
        online: false,
        version: 'Unavailable',
        modules: [],
        error: 'Gotenberg reports unhealthy modules.',
      }
    }
    const details = parsed.output.details
    const modules =
      details && typeof details === 'object' && !Array.isArray(details)
        ? Object.entries(details).map(([name, value]) => ({
            name,
            status:
              value && typeof value === 'object' && 'status' in value && value.status === 'up'
                ? 'up'
                : 'down',
          }))
        : []
    let versionText = 'Unknown'
    try {
      const response = await fetch(endpoint(url, '/version'), {
        signal,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      })
      if (response.ok) versionText = (await response.text()).trim().slice(0, 80) || 'Unknown'
    } catch {
      if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
      // Some proxies allow /health but not /version: still show the healthy service.
    }
    return { online: true, version: versionText, modules }
  } catch (error) {
    if (signal?.aborted) throw error
    return { online: false, version: 'Unavailable', modules: [], error: connectionHint() }
  }
}

/** Build the exact Gotenberg multipart form without an intermediate proxy. */
export function createGotenbergForm(
  operation: Operation,
  payload: ConversionPayload,
  files: File[],
  auxiliary: File[],
): FormData {
  validateFiles(operation, files, auxiliary, MAX_UPLOAD_BYTES)
  if (operation.id === 'watermark' || operation.id === 'stamp') {
    const source = payload.fields[`${operation.id}Source`]
    const expression = payload.fields[`${operation.id}Expression`]
    if (source !== 'text' && (auxiliary.length !== 1 || auxiliary[0]?.name !== expression)) {
      throw new InputError('Upload a source file and match its filename in the expression field.')
    }
    if (source === 'text' && auxiliary.length !== 0) {
      throw new InputError('A text overlay must not include an image or PDF attachment.')
    }
  }
  const form = new FormData()
  for (const [key, value] of Object.entries({ ...payload.fields, ...payload.advanced })) {
    if (value !== '') form.set(key, String(value))
  }
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

export type ConversionResult = {
  blob: Blob
  type: string
  name: string
  trace?: string
}

export async function convertWithGotenberg(
  baseUrl: string,
  candidate: unknown,
  files: File[],
  auxiliary: File[],
  signal: AbortSignal,
): Promise<ConversionResult> {
  const { operation, payload } = validatePayload(candidate)
  const body = createGotenbergForm(operation, payload, files, auxiliary)
  let response: Response
  try {
    // Do not send custom request headers; multipart FormData can be a CORS-simple request.
    response = await fetch(endpoint(baseUrl, operation.path), {
      method: 'POST',
      body,
      signal,
      credentials: 'same-origin',
      redirect: 'error',
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(connectionHint())
  }
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 1_500)
    throw new Error(detail || `Gotenberg returned HTTP ${response.status}.`)
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
    blob,
    type,
    name: filename,
    trace: response.headers.get('Gotenberg-Trace') ?? undefined,
  }
}
