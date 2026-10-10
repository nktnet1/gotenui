import * as v from 'valibot'
import { normalizeBackendUrl } from './backend-url.ts'
import type { Operation } from './operations.ts'
import { downloadFilename, responseExtension } from './security.ts'
import { type ConversionPayload, InputError, validateFiles, validatePayload } from './validation.ts'

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

/** The browser contacts only the same-origin Gotenui endpoint. */
export async function getGotenbergStatus(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ServerStatus> {
  const url = validatedBackend(baseUrl)
  try {
    const response = await fetch(`/api/gotenberg/status?${new URLSearchParams({ url })}`, {
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

/** Rebuild the exact Gotenberg multipart form after server-side validation. */
export function createGotenbergForm(
  operation: Operation,
  payload: ConversionPayload,
  files: File[],
  auxiliary: File[],
  maxBytes = MAX_UPLOAD_BYTES,
): FormData {
  validateFiles(operation, files, auxiliary, maxBytes)
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

/** The proxy revalidates the JSON and files, and reconstructs a safe Gotenberg form. */
export async function convertWithGotenberg(
  baseUrl: string,
  candidate: unknown,
  files: File[],
  auxiliary: File[],
  signal: AbortSignal,
): Promise<ConversionResult> {
  const url = validatedBackend(baseUrl)
  const { operation, payload } = validatePayload(candidate)
  // Keep fast client-side feedback; all fields and files are checked again by the server.
  validateFiles(operation, files, auxiliary, MAX_UPLOAD_BYTES)
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
      headers: { 'X-Gotenberg-Url': url },
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(connectionHint())
  }
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 1_500)
    throw new Error(detail || `Gotenui proxy returned HTTP ${response.status}.`)
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
