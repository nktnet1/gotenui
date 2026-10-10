import urlJoin from 'url-join'
import * as v from 'valibot'
import { resolveConnectionTarget } from '#/lib/connection-target.server'
import { createGotenbergForm, REQUEST_TIMEOUT_MS, type ServerStatus } from '#/lib/gotenberg-client'
import type { Operation } from '#/lib/operations'
import type { PostProcessFiles } from '#/lib/pdf-post-processing'
import { isPrometheusMetrics } from '#/lib/prometheus-metrics'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  limitResponseStream,
  ProxyInputError,
  parseAllowedBackends,
  readLimitedBody,
  requireSameOrigin,
} from '#/lib/proxy-policy'
import { verifyConversionSignature } from '#/lib/response-signature'
import { parseServerConnections, publicServerConnections } from '#/lib/server-connections.server'
import { uiFeatures } from '#/lib/ui-features.server'
import {
  type ConversionPayload,
  InputError,
  validateFiles,
  validatePayload,
} from '#/lib/validation'

const serverEnvSchema = v.object({
  GOTENBERG_ALLOWED_URLS: v.optional(v.pipe(v.string(), v.maxLength(20_000))),
  GOTENUI_MAX_REQUEST_BYTES: v.optional(v.pipe(v.string(), v.regex(/^\d+$/))),
  GOTENUI_MAX_RESPONSE_BYTES: v.optional(v.pipe(v.string(), v.regex(/^\d+$/))),
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
  const maxResponseBytes = env.GOTENUI_MAX_RESPONSE_BYTES
    ? Number(env.GOTENUI_MAX_RESPONSE_BYTES)
    : DEFAULT_MAX_RESPONSE_BYTES
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1024 ||
    maxResponseBytes > 500_000_000
  ) {
    throw new Error('GOTENUI_MAX_RESPONSE_BYTES must be between 1024 and 500000000.')
  }
  const allowed = parseAllowedBackends(env.GOTENBERG_ALLOWED_URLS)
  return {
    maxBytes,
    maxResponseBytes,
    allowed,
    ...parseServerConnections(process.env, allowed),
  }
}

const safeResponseHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
}

// Distinguish a real HEAD probe from a static host's 200 SPA fallback.
const healthProbeHeaders = { ...safeResponseHeaders, 'X-Gotenui-Health-Probe': '1' }

export function proxyConnectionsRequest(request: Request): Response {
  requireSameOrigin(request)
  const { connections } = runtimeConfig()
  return Response.json(
    { connections: publicServerConnections(connections), features: uiFeatures(process.env) },
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

class StatusProbeError extends Error {}

/** Health and version are diagnostic text, never unbounded downloads. */
async function boundedStatusText(response: Response, maxBytes: number): Promise<string> {
  const announced = response.headers.get('content-length')
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) {
    await response.body?.cancel().catch(() => {})
    throw new StatusProbeError('Gotenberg status response exceeds its size limit.')
  }
  try {
    const bytes = await readLimitedBody(response.body, maxBytes)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new StatusProbeError('Gotenberg status response is invalid or too large.')
  }
}

function fetchOptions(request: Request): Pick<RequestInit, 'signal' | 'redirect' | 'cache'> {
  return {
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    redirect: 'error', // A redirected Gotenberg URL must never escape the allowlist.
    cache: 'no-store',
  }
}

function upstreamConversionHeaders(
  auth: HeadersInit | undefined,
  payload: ConversionPayload,
  acceptsOutputFilename: boolean,
): Headers {
  const headers = new Headers(auth)
  if (acceptsOutputFilename && payload.outputName) {
    headers.set('Gotenberg-Output-Filename', payload.outputName)
  }
  if (payload.requestTrace) headers.set('Gotenberg-Trace', payload.requestTrace)
  if (payload.traceparent) headers.set('traceparent', payload.traceparent)
  if (payload.tracestate) headers.set('tracestate', payload.tracestate)
  const webhook = payload.webhook
  if (webhook) {
    headers.set('Gotenberg-Webhook-Url', webhook.url)
    if (webhook.method) headers.set('Gotenberg-Webhook-Method', webhook.method)
    if (webhook.errorUrl) headers.set('Gotenberg-Webhook-Error-Url', webhook.errorUrl)
    if (webhook.errorMethod) headers.set('Gotenberg-Webhook-Error-Method', webhook.errorMethod)
    if (webhook.eventsUrl) headers.set('Gotenberg-Webhook-Events-Url', webhook.eventsUrl)
    if (webhook.extraHttpHeaders) {
      headers.set('Gotenberg-Webhook-Extra-Http-Headers', JSON.stringify(webhook.extraHttpHeaders))
    }
  }
  return headers
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

function expectedConversionContentType(output: string, format: string | boolean | undefined) {
  switch (output) {
    case 'pdf':
      return 'application/pdf'
    case 'zip':
      return 'application/zip'
    case 'json':
      return 'application/json'
    case 'image':
      return `image/${format === 'jpeg' || format === 'webp' ? format : 'png'}`
    default:
      throw new Error('Unknown conversion output.')
  }
}

/** Gotenberg chooses PDF versus ZIP based on the number of resulting documents.
 * Keep exact media-type checks for all other routes and never accept HTML fallbacks.
 */
function allowedConversionContentTypes(
  operation: Operation,
  payload: ConversionPayload,
  files: readonly File[],
): readonly string[] {
  const primaryType = expectedConversionContentType(operation.output, payload.fields.format)
  // Even an intervals split can produce a PDF when there is just one output.
  // The proxy cannot know its page count without reading the input document.
  if (operation.id === 'split') return ['application/pdf', 'application/zip']
  if (operation.output !== 'pdf') return [primaryType]

  const remoteDocuments = (payload.downloadFrom ?? []).filter(
    (file) => !file.embedded && !file.field,
  ).length
  const multipleDocuments =
    files.length + remoteDocuments > 1 &&
    (operation.input === 'office' || (operation.input === 'pdf' && operation.id !== 'merge'))
  const splitMode = payload.fields.splitMode ?? payload.advanced.splitMode
  const postProcessingSplit = splitMode === 'pages' || splitMode === 'intervals'
  // PDF tools (apart from merge) and LibreOffice return ZIP for multiple
  // independent source documents. Conversions with a split step can also
  // produce ZIP, whereas merged or single-result outputs remain PDF.
  return multipleDocuments || postProcessingSplit
    ? ['application/pdf', 'application/zip']
    : [primaryType]
}

/** An untrusted upstream may send an incorrect or missing content-length. */
function conversionResponseLength(header: string | null, maxBytes: number): number | undefined {
  if (header === null) return undefined
  if (!/^(0|[1-9]\d*)$/.test(header)) {
    throw new ProxyInputError('Gotenberg returned an invalid response length.', 502)
  }
  const length = Number(header)
  if (!Number.isSafeInteger(length)) {
    throw new ProxyInputError('Gotenberg returned an invalid response length.', 502)
  }
  if (length === 0) {
    throw new ProxyInputError('Gotenberg returned an empty conversion response.', 502)
  }
  if (length > maxBytes) {
    throw new ProxyInputError(
      `Gotenberg conversion response exceeds the ${maxBytes} byte limit.`,
      502,
    )
  }
  return length
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
  const { maxBytes, maxResponseBytes, ...settings } = runtimeConfig()
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
  const postFiles: PostProcessFiles = {}
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
    } else if (key === 'embeds' && value instanceof File) {
      if (!postFiles.embeds) postFiles.embeds = []
      postFiles.embeds.push(value)
    } else if (
      (key === 'watermark' || key === 'stamp' || key === 'facturxXml') &&
      value instanceof File
    ) {
      if (key === 'facturxXml') {
        if (postFiles.facturxXml)
          throw new ProxyInputError('Only one facturxXml file may be uploaded.')
        postFiles.facturxXml = value
      } else {
        const uploads = postFiles[key]
        postFiles[key] = uploads
          ? [...(Array.isArray(uploads) ? uploads : [uploads]), value]
          : [value]
      }
    } else {
      throw new ProxyInputError('The multipart request contains unsupported fields.')
    }
  }
  if (payloadCount !== 1) throw new ProxyInputError('Exactly one conversion payload is required.')
  const { operation, payload } = validatePayload(candidate)
  validateFiles(operation, files, auxiliary, maxBytes, payload, postFiles)
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    settings,
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
  )
  const form = createGotenbergForm(operation, payload, files, auxiliary, maxBytes, postFiles)
  const upstream = await fetcher(urlJoin(url, operation.path), {
    method: 'POST',
    ...fetchOptions(request),
    body: form,
    headers: upstreamConversionHeaders(authHeaders, payload, operation.output !== 'json'),
    credentials: 'omit',
  })
  if (!upstream.ok) {
    const headers = new Headers({
      ...safeResponseHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
    })
    const trace = upstream.headers.get('gotenberg-trace')
    if (trace) headers.set('Gotenberg-Trace', trace)
    return new Response(await upstreamErrorText(upstream), {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers,
    })
  }
  const headers = new Headers(safeResponseHeaders)
  for (const name of ['content-type', 'content-disposition', 'gotenberg-trace']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (upstream.status === 204 || upstream.status === 202) {
    await upstream.body?.cancel().catch(() => {})
    if (!payload.webhook) {
      throw new ProxyInputError(
        'Gotenberg returned asynchronous acceptance without a webhook.',
        502,
      )
    }
    return new Response(null, { status: upstream.status, headers })
  }
  const allowedTypes = allowedConversionContentTypes(operation, payload, files)
  const returnedType = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (
    upstream.status !== 200 ||
    !returnedType ||
    !allowedTypes.includes(returnedType) ||
    !upstream.body
  ) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg returned an unexpected conversion response.', 502)
  }
  let declaredLength: number | undefined
  try {
    // Fetch decodes compressed upstream responses but leaves their compressed
    // Content-Length header intact. Always limit decoded stream bytes instead.
    const contentEncoding = upstream.headers.get('content-encoding')
    if (!contentEncoding || contentEncoding.toLowerCase() === 'identity') {
      declaredLength = conversionResponseLength(
        upstream.headers.get('content-length'),
        maxResponseBytes,
      )
    }
  } catch (error) {
    await upstream.body.cancel().catch(() => {})
    throw error
  }
  const checkedBody = await verifyConversionSignature(upstream.body, returnedType)
  return new Response(limitResponseStream(checkedBody, maxResponseBytes, declaredLength), {
    status: 200,
    headers,
  })
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
    if (!health.ok) throw new StatusProbeError(`Gotenberg returned HTTP ${health.status}.`)
    let healthPayload: unknown
    try {
      healthPayload = JSON.parse(await boundedStatusText(health, 128_000))
    } catch (error) {
      if (error instanceof StatusProbeError) throw error
      throw new StatusProbeError('This URL did not return a Gotenberg health response.')
    }
    const parsed = v.safeParse(healthSchema, healthPayload)
    if (!parsed.success)
      throw new StatusProbeError('This URL did not return a Gotenberg health response.')
    if (parsed.output.status !== 'up')
      throw new StatusProbeError('Gotenberg reports unhealthy modules.')
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
        version = (await boundedStatusText(response, 1_024)).trim().slice(0, 80) || 'Unknown'
      }
    } catch {
      // The version endpoint is optional, unless it explicitly rejects authentication.
    }
    if (versionAuthFailure !== undefined) {
      throw new StatusProbeError(`Gotenberg returned HTTP ${versionAuthFailure} from /version.`)
    }
    status = { online: true, version, modules }
  } catch (error) {
    status = {
      online: false,
      version: 'Unavailable',
      modules: [],
      error:
        error instanceof StatusProbeError ? error.message : 'Could not contact Gotenberg safely.',
    }
  }
  return Response.json(status, { headers: safeResponseHeaders })
}

/** Forward the lightweight Gotenberg HEAD /health probe without buffering a response body. */
export async function proxyHeadHealthRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  if (request.method !== 'HEAD') {
    throw new ProxyInputError('Health probes must use HEAD.', 405)
  }
  const search = new URL(request.url).searchParams
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    runtimeConfig(),
    search.get('url'),
    search.get('connection'),
  )
  const upstream = await fetcher(urlJoin(url, '/health'), {
    method: 'HEAD',
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit',
  })
  // Gotenberg reports 200 or 503. Forward an authentication failure for diagnostic
  // purposes; unexpected responses are gateway errors, not healthy probes.
  const status = [200, 503, 401, 403].includes(upstream.status) ? upstream.status : 502
  await upstream.body?.cancel().catch(() => {})
  return new Response(null, { status, headers: healthProbeHeaders })
}

/** HEAD error responses must never include the text body used by other routes. */
export function proxyHeadErrorResponse(error: unknown): Response {
  const result = proxyErrorResponse(error)
  return new Response(null, { status: result.status, headers: healthProbeHeaders })
}

/** The selected Gotenberg instance authenticates metrics; this is not an arbitrary GET relay. */
export async function proxyMetricsRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  if (request.method !== 'POST') {
    throw new ProxyInputError('Metrics requests must use POST.', 405)
  }
  const { url, headers: authHeaders } = resolveConnectionTarget(
    request,
    runtimeConfig(),
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
  )
  const upstream = await fetcher(urlJoin(url, '/prometheus/metrics'), {
    method: 'GET',
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit',
  })
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {})
    const message =
      upstream.status === 404
        ? 'The legacy Gotenberg Prometheus endpoint is unavailable. Check PROMETHEUS_METRICS_PATH or configure OpenTelemetry instead.'
        : upstream.status === 401 || upstream.status === 403
          ? 'Gotenberg rejected authentication for its metrics endpoint.'
          : `Gotenberg returned HTTP ${upstream.status} from /prometheus/metrics.`
    return new Response(message, {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const MAX_METRICS_RESPONSE_BYTES = 2_000_000
  const declaredSize = Number(upstream.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_METRICS_RESPONSE_BYTES) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg metrics response exceeds the 2 MB limit.', 502)
  }
  const contentType = upstream.headers.get('content-type')?.toLowerCase() ?? ''
  if (
    !contentType.startsWith('text/plain') &&
    !contentType.startsWith('application/openmetrics-text')
  ) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg metrics did not return Prometheus text.', 502)
  }
  if (!upstream.body) {
    throw new ProxyInputError('Gotenberg returned an empty metrics response.', 502)
  }
  let bytes: Uint8Array
  try {
    bytes = await readLimitedBody(upstream.body, MAX_METRICS_RESPONSE_BYTES)
  } catch (error) {
    if (error instanceof ProxyInputError && error.status === 413) {
      throw new ProxyInputError('Gotenberg metrics response exceeds the 2 MB limit.', 502)
    }
    throw error
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ProxyInputError('Gotenberg metrics did not contain valid UTF-8.', 502)
  }
  if (!isPrometheusMetrics(text)) {
    throw new ProxyInputError('Gotenberg returned an unexpected metrics response.', 502)
  }
  return new Response(text, {
    status: 200,
    headers: {
      ...safeResponseHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Gotenui-Metrics': '1',
    },
  })
}

/** The selected Gotenberg instance controls access to its optional debug route. */
export async function proxyDebugRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
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
