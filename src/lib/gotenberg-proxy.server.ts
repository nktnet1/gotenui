import urlJoin from 'url-join'
import * as v from 'valibot'
import { resolveConnectionTarget } from '#/lib/connection-target.server'
import { requireDebugAccess } from '#/lib/debug-access.server'
import { createGotenbergForm, REQUEST_TIMEOUT_MS, type ServerStatus } from '#/lib/gotenberg-client'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  ProxyInputError,
  parseAllowedBackends,
  readLimitedBody,
  requireSameOrigin,
} from '#/lib/proxy-policy'
import { parseServerConnections, publicServerConnections } from '#/lib/server-connections.server'
import { InputError, validateFiles, validatePayload } from '#/lib/validation'

const serverEnvSchema = v.object({
  GOTENBERG_ALLOWED_URLS: v.optional(v.pipe(v.string(), v.maxLength(20_000))),
  GOTENUI_MAX_REQUEST_BYTES: v.optional(v.pipe(v.string(), v.regex(/^\d+$/))),
})

const healthSchema = v.object({
  status: v.picklist(['up', 'down']),
  details: v.optional(v.record(v.string(), v.unknown())),
})

function runtimeConfig() {
  const env = v.parse(serverEnvSchema, process.env)
  const maxBytes = env.GOTENUI_MAX_REQUEST_BYTES
    ? Number(env.GOTENUI_MAX_REQUEST_BYTES)
    : DEFAULT_MAX_REQUEST_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 250_000_000) {
    throw new Error('GOTENUI_MAX_REQUEST_BYTES must be between 1024 and 250000000.')
  }
  const allowed = parseAllowedBackends(env.GOTENBERG_ALLOWED_URLS)
  return {
    maxBytes,
    allowed,
    ...parseServerConnections(process.env, allowed),
  }
}

const safeResponseHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
}

export function proxyConnectionsRequest(request: Request): Response {
  requireSameOrigin(request)
  const { connections } = runtimeConfig()
  return Response.json(
    { connections: publicServerConnections(connections) },
    { headers: safeResponseHeaders },
  )
}

export function proxyErrorResponse(error: unknown): Response {
  if (error instanceof ProxyInputError || error instanceof InputError) {
    return new Response(error.message, {
      status: error.status,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
  return new Response(
    timedOut
      ? 'Gotenberg did not respond before the request timed out.'
      : 'Gotenberg proxy failed.',
    {
      status: timedOut ? 504 : 502,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    },
  )
}

function fetchOptions(request: Request): Pick<RequestInit, 'signal' | 'redirect' | 'cache'> {
  return {
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    redirect: 'error', // A redirected Gotenberg URL must never escape the allowlist.
    cache: 'no-store',
  }
}

async function upstreamErrorText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return `Gotenberg returned HTTP ${response.status}.`
  try {
    const { value } = await reader.read()
    return (
      new TextDecoder().decode(value?.subarray(0, 1_500)).trim() ||
      `Gotenberg returned HTTP ${response.status}.`
    )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Every request resolves a validated destination and its authentication, without sessions. */
export async function proxyConversionRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data;\s*boundary=[\w-]{1,200}$/i.test(contentType)) {
    throw new ProxyInputError('Expected a multipart/form-data conversion request.')
  }
  const { maxBytes, ...settings } = runtimeConfig()
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    throw new ProxyInputError(`Request exceeds the ${maxBytes} byte upload limit.`, 413)
  }
  const bytes = await readLimitedBody(request.body, maxBytes)
  let fields: FormData
  try {
    fields = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    throw new ProxyInputError('Invalid multipart form data.')
  }
  let candidate: unknown
  const files: File[] = []
  const auxiliary: File[] = []
  let payloadCount = 0
  for (const [key, value] of fields) {
    if (key === 'payload' && typeof value === 'string' && value.length <= 400_000) {
      payloadCount++
      try {
        candidate = JSON.parse(value)
      } catch {
        throw new ProxyInputError('The conversion payload must be valid JSON.')
      }
    } else if (key === 'files' && value instanceof File) {
      files.push(value)
    } else if (key === 'auxiliary' && value instanceof File) {
      auxiliary.push(value)
    } else {
      throw new ProxyInputError('The multipart request contains unsupported fields.')
    }
  }
  if (payloadCount !== 1) throw new ProxyInputError('Exactly one conversion payload is required.')
  const { operation, payload } = validatePayload(candidate)
  validateFiles(operation, files, auxiliary, maxBytes)
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    settings,
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
  )
  const form = createGotenbergForm(operation, payload, files, auxiliary, maxBytes)
  const upstream = await fetcher(urlJoin(url, operation.path), {
    method: 'POST',
    ...fetchOptions(request),
    body: form,
    headers: authHeaders,
    credentials: 'omit',
  })
  if (!upstream.ok) {
    return new Response(await upstreamErrorText(upstream), {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const headers = new Headers(safeResponseHeaders)
  for (const name of ['content-type', 'content-disposition', 'gotenberg-trace']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/octet-stream')
  return new Response(upstream.body, { status: 200, headers })
}

/** A compact JSON status response for the browser, with no browser-to-Gotenberg fetches. */
export async function proxyStatusRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const search = new URL(request.url).searchParams
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    runtimeConfig(),
    search.get('url'),
    search.get('connection'),
  )
  const options = {
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit' as const,
  }
  let status: ServerStatus
  try {
    const health = await fetcher(urlJoin(url, '/health'), options)
    if (!health.ok) throw new Error(`Gotenberg returned HTTP ${health.status}.`)
    const parsed = v.safeParse(healthSchema, await health.json())
    if (!parsed.success) throw new Error('This URL did not return a Gotenberg health response.')
    if (parsed.output.status !== 'up') throw new Error('Gotenberg reports unhealthy modules.')
    const modules = Object.entries(parsed.output.details ?? {}).map(([name, value]) => ({
      name,
      status:
        value && typeof value === 'object' && 'status' in value && value.status === 'up'
          ? 'up'
          : 'down',
    }))
    let version = 'Unknown'
    let versionAuthFailure: number | undefined
    try {
      const response = await fetcher(urlJoin(url, '/version'), options)
      if (response.status === 401 || response.status === 403) {
        versionAuthFailure = response.status
      } else if (response.ok) {
        version = (await response.text()).trim().slice(0, 80) || 'Unknown'
      }
    } catch {
      // The version endpoint is optional, unless it explicitly rejects authentication.
    }
    if (versionAuthFailure !== undefined) {
      throw new Error(`Gotenberg returned HTTP ${versionAuthFailure} from /version.`)
    }
    status = { online: true, version, modules }
  } catch (error) {
    status = {
      online: false,
      version: 'Unavailable',
      modules: [],
      error: error instanceof Error ? error.message : 'Gotenberg is unavailable.',
    }
  }
  return Response.json(status, { headers: safeResponseHeaders })
}

/** Debug is opt-in and requires an independent admin key, even for anonymous instances. */
export async function proxyDebugRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  requireDebugAccess(request, process.env.GOTENUI_DEBUG_ACCESS_KEY)
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    runtimeConfig(),
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
  )
  const upstream = await fetcher(urlJoin(url, '/debug'), {
    method: 'GET',
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit',
  })
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {})
    const message =
      upstream.status === 404
        ? 'Gotenberg debug is disabled. Enable API_ENABLE_DEBUG_ROUTE on your instance.'
        : upstream.status === 401 || upstream.status === 403
          ? 'Gotenberg rejected authentication for its debug route.'
          : `Gotenberg returned HTTP ${upstream.status} from /debug.`
    return new Response(message, {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const MAX_DEBUG_RESPONSE_BYTES = 1_000_000
  const declaredSize = Number(upstream.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_DEBUG_RESPONSE_BYTES) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg debug response exceeds the 1 MB limit.', 502)
  }
  if (!upstream.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg debug did not return JSON.', 502)
  }
  if (!upstream.body) throw new ProxyInputError('Gotenberg returned an empty debug response.', 502)

  let bytes: Uint8Array
  try {
    bytes = await readLimitedBody(upstream.body, MAX_DEBUG_RESPONSE_BYTES)
  } catch (error) {
    if (error instanceof ProxyInputError && error.status === 413) {
      throw new ProxyInputError('Gotenberg debug response exceeds the 1 MB limit.', 502)
    }
    throw error
  }
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ProxyInputError('Gotenberg debug returned invalid JSON.', 502)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProxyInputError('Gotenberg debug returned an unexpected response.', 502)
  }
  return Response.json(payload, { headers: safeResponseHeaders })
}
