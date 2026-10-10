import urlJoin from 'url-join'
import * as v from 'valibot'
import { createGotenbergForm, REQUEST_TIMEOUT_MS, type ServerStatus } from '#/lib/gotenberg-client'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEMO_GOTENBERG_URL,
  ProxyInputError,
  parseAllowedBackends,
  readLimitedBody,
  requireAllowedBackend,
  requireSameOrigin,
} from '#/lib/proxy-policy'
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
  return {
    maxBytes,
    allowed: parseAllowedBackends(env.GOTENBERG_ALLOWED_URLS),
  }
}

const safeResponseHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
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
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** No state, credentials, arbitrary URLs or files are persisted between requests. */
export async function proxyConversionRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data;\s*boundary=[\w-]{1,200}$/i.test(contentType)) {
    throw new ProxyInputError('Expected a multipart/form-data conversion request.')
  }
  const { maxBytes, allowed } = runtimeConfig()
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
  const url = requireAllowedBackend(request.headers.get('x-gotenberg-url') ?? '', allowed)
  const form = createGotenbergForm(operation, payload, files, auxiliary, maxBytes)
  const upstream = await fetcher(urlJoin(url, operation.path), {
    method: 'POST',
    ...fetchOptions(request),
    body: form,
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
  const candidate = new URL(request.url).searchParams.get('url') ?? DEMO_GOTENBERG_URL
  const url = requireAllowedBackend(candidate, runtimeConfig().allowed)
  const options = fetchOptions(request)
  let status: ServerStatus
  try {
    const health = await fetcher(urlJoin(url, '/health'), {
      ...options,
      credentials: 'omit',
    })
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
    try {
      const response = await fetcher(urlJoin(url, '/version'), {
        ...options,
        credentials: 'omit',
      })
      if (response.ok) version = (await response.text()).trim().slice(0, 80) || 'Unknown'
    } catch {
      // The version endpoint is optional. A healthy service is still usable.
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
