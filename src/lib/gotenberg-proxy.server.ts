import { joinURL } from 'ufo'
import * as v from 'valibot'
import { resolveAuthenticatedConnectionTarget } from '#/lib/connection-target.server'
import {
  expectedConversionContentType,
  fixedRouteResponseTypes,
  isNamedAttachmentResponse,
} from '#/lib/conversion-response'
import { createGotenbergForm, REQUEST_TIMEOUT_MS, type ServerStatus } from '#/lib/gotenberg-client'
import { adaptConversionForm } from '#/lib/gotenberg-conversion-adapter'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { describePdfUpstreamError } from '#/lib/gotenberg-v93-errors'
import {
  type GotenbergVersion,
  MAX_GOTENBERG_VERSION_LENGTH,
  parseGotenbergVersion,
  requiresGotenberg91ForExtraction,
  requiresGotenberg92ForComposition,
  requiresGotenberg94ForStampPosition,
  requiresGotenberg95ForPaperSize,
  requiresGotenberg96ForSignatureDrop,
  requiresGotenberg97ForFileBookmarks,
  requiresGotenberg98ForExtractTextFormat,
  requiresGotenberg99ForCompressStreams,
  type SupportedGotenbergMajor,
  sameGotenbergApiVersion,
} from '#/lib/gotenberg-version'
import { multipartBody } from '#/lib/multipart-body'
import {
  invalidateOAuth2Authorization,
  type OAuth2ClientCredentials,
} from '#/lib/oauth2-client-credentials.server'
import { operationMinimumVersionReason } from '#/lib/operation-availability'
import { hasGotenberg92PageSyntax, stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import {
  conversionPipelineResponseTypes,
  isStandaloneAttachmentExtraction,
  type PdfPipelineStage,
  parsePdfPipeline,
  pdfStageAssetNames,
  pipelineMayPreservePdfHeader,
  pipelineResponseTypes,
} from '#/lib/pdf-pipeline'
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
import { validateAssetFilenameRegistration } from '#/lib/remote-stage-assets'
import {
  outboundCompatibilityReasons,
  requestFieldCompatibilityReason,
} from '#/lib/request-compatibility'
import { verifyConversionSignature } from '#/lib/response-signature'
import { responseMediaType, safeAttachmentDisposition } from '#/lib/security'
import {
  parseServerConnections,
  publicServerConnections,
  requireServerConnection,
} from '#/lib/server-connections.server'
import { sourceDocumentReason } from '#/lib/source-documents'
import { uiFeatures } from '#/lib/ui-features.server'
import {
  type ConversionPayload,
  InputError,
  validateFiles,
  validatePayload,
} from '#/lib/validation'
import { validateZipInputs } from '#/lib/zip-input-validation'
import type { Operation } from '#/tools/registry'

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

class DiagnosticBodyError extends Error {
  constructor(readonly reason: 'invalid-length' | 'too-large' | 'length-mismatch') {
    super(reason)
  }
}

/** Some gateways advertise malformed or truncated diagnostic bodies. Fetch also
 * transparently decompresses responses, so encoded lengths cannot be compared
 * with the decoded bytes it exposes. Never trust Content-Length as a size cap.
 */
async function boundedDiagnosticBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const announced = response.headers.get('content-length')
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  let expectedLength: number | undefined
  if (announced !== null && (!encoding || encoding === 'identity')) {
    if (!/^\d+$/.test(announced) || !Number.isSafeInteger(Number(announced))) {
      await response.body?.cancel().catch(() => {})
      throw new DiagnosticBodyError('invalid-length')
    }
    expectedLength = Number(announced)
    if (expectedLength > maxBytes) {
      await response.body?.cancel().catch(() => {})
      throw new DiagnosticBodyError('too-large')
    }
  }
  let bytes: Uint8Array
  try {
    bytes = await readLimitedBody(response.body, maxBytes)
  } catch (error) {
    if (error instanceof ProxyInputError && error.status === 413) {
      throw new DiagnosticBodyError('too-large')
    }
    throw error
  }
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new DiagnosticBodyError('length-mismatch')
  }
  return bytes
}

/** Health and version are diagnostic text, never unbounded downloads. */
async function boundedStatusText(response: Response, maxBytes: number): Promise<string> {
  try {
    const bytes = await boundedDiagnosticBody(response, maxBytes)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof DiagnosticBodyError && error.reason === 'too-large') {
      throw new StatusProbeError('Gotenberg status response exceeds its size limit.')
    }
    throw new StatusProbeError('Gotenberg status response is invalid or too large.')
  }
}

async function boundedProxyDiagnosticBody(
  response: Response,
  maxBytes: number,
  name: 'debug' | 'metrics',
  sizeLabel: string,
): Promise<Uint8Array> {
  try {
    return await boundedDiagnosticBody(response, maxBytes)
  } catch (error) {
    if (error instanceof DiagnosticBodyError) {
      throw new ProxyInputError(
        error.reason === 'too-large'
          ? `Gotenberg ${name} response exceeds the ${sizeLabel} limit.`
          : `Gotenberg ${name} returned an invalid response length.`,
        502,
      )
    }
    throw error
  }
}

function invalidateUnauthorized(
  status: number,
  target: {
    url: string
    oauth2?: OAuth2ClientCredentials
    headers?: HeadersInit
  },
): void {
  if (status === 401 && target.oauth2) {
    const authorization = new Headers(target.headers).get('authorization')
    if (authorization) invalidateOAuth2Authorization(target.url, target.oauth2, authorization)
  }
}

function fetchOptions(request: Request): Pick<RequestInit, 'signal' | 'redirect' | 'cache'> {
  return {
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    redirect: 'error', // A redirected Gotenberg URL must never escape the allowlist.
    cache: 'no-store',
  }
}

/** Fetch Headers expects a ByteString, while Go reads these header values as UTF-8. */
function utf8HeaderValue(value: string): string {
  let encoded = ''
  for (const byte of new TextEncoder().encode(value)) {
    encoded += String.fromCharCode(byte)
  }
  return encoded
}

function upstreamConversionHeaders(
  auth: HeadersInit | undefined,
  payload: ConversionPayload,
  acceptsOutputFilename: boolean,
  version: SupportedGotenbergMajor,
): Headers {
  const headers = new Headers(auth)
  if (acceptsOutputFilename && payload.outputName) {
    headers.set('Gotenberg-Output-Filename', utf8HeaderValue(payload.outputName))
  }
  if (payload.requestTrace) headers.set('Gotenberg-Trace', payload.requestTrace)
  if (payload.traceparent) headers.set('traceparent', payload.traceparent)
  if (payload.tracestate) headers.set('tracestate', payload.tracestate)
  const webhook = payload.webhook
  if (webhook) {
    // Keep the original target, including signed paths and query escapes.
    headers.set('Gotenberg-Webhook-Url', utf8HeaderValue(webhook.url))
    if (webhook.method) headers.set('Gotenberg-Webhook-Method', webhook.method)
    if (version === 8 && webhook.errorUrl)
      headers.set('Gotenberg-Webhook-Error-Url', utf8HeaderValue(webhook.errorUrl))
    if (version === 8 && webhook.errorMethod)
      headers.set('Gotenberg-Webhook-Error-Method', webhook.errorMethod)
    if (webhook.eventsUrl)
      headers.set('Gotenberg-Webhook-Events-Url', utf8HeaderValue(webhook.eventsUrl))
    if (webhook.extraHttpHeaders) {
      headers.set(
        'Gotenberg-Webhook-Extra-Http-Headers',
        utf8HeaderValue(JSON.stringify(webhook.extraHttpHeaders)),
      )
    }
  }
  return headers
}

/** Resolve the actual upstream major for every request, including queued/direct API calls.
 * Do not cache this across connection changes or upstream upgrades.
 */
async function conversionTargetVersion(
  request: Request,
  fetcher: typeof fetch,
  target: { url: string; headers?: HeadersInit; oauth2?: OAuth2ClientCredentials },
): Promise<GotenbergVersion> {
  const response = await fetcher(joinURL(target.url, '/version'), {
    method: 'GET',
    ...fetchOptions(request),
    headers: target.headers,
    credentials: 'omit',
  })
  if (response.status !== 200) {
    invalidateUnauthorized(response.status, target)
    await response.body?.cancel().catch(() => {})
    throw new ProxyInputError(
      `Could not verify the Gotenberg version (HTTP ${response.status}).`,
      response.status === 401 || response.status === 403 ? response.status : 502,
    )
  }
  let raw: string
  try {
    raw = (await boundedStatusText(response, 1_024)).trim()
  } catch {
    throw new ProxyInputError('Gotenberg returned an invalid /version response.', 502)
  }
  const parsed = parseGotenbergVersion(raw)
  if (!parsed || (parsed.major !== 8 && parsed.major !== 9)) {
    throw new ProxyInputError(
      `Unsupported Gotenberg version: ${raw.slice(0, MAX_GOTENBERG_VERSION_LENGTH) || 'Unknown'}. Use v8 or v9.`,
      409,
    )
  }
  return parsed
}

/** Preserve Gotenberg's diagnostic headers, not arbitrary upstream response headers. */
function copyUpstreamDiagnostics(upstream: Response, headers: Headers): void {
  const trace = upstream.headers.get('gotenberg-trace')
  // Untrusted upstreams must not turn correlation IDs into unbounded or
  // unexpected log/UI content. This matches the request trace grammar.
  if (trace && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trace))
    headers.set('Gotenberg-Trace', trace)
  const residual = upstream.headers.get('Gotenberg-Remediation-Residual')
  const rolledBack = upstream.headers.get('Gotenberg-Remediation-Rolled-Back')
  if (residual !== null || rolledBack !== null) {
    if (
      residual !== null &&
      rolledBack !== null &&
      /^\d{1,10}$/.test(residual) &&
      /^\d{1,10}$/.test(rolledBack)
    ) {
      headers.set('Gotenberg-Remediation-Residual', residual)
      headers.set('Gotenberg-Remediation-Rolled-Back', rolledBack)
    } else {
      // Partial/malformed diagnostics must never be mistaken for two zeros.
      headers.set('Gotenui-Remediation-Incomplete', '1')
    }
  }
  const version = upstream.headers.get('gotenberg-version')
  if (version && parseGotenbergVersion(version)) {
    headers.set('Gotenberg-Version', version)
  }
}
/** An upstream error may arrive in arbitrarily small network chunks. Read up
 * to the diagnostic limit rather than truncating at the first chunk, while
 * cancelling the remainder so a large error cannot be buffered by the proxy.
 */
async function upstreamErrorText(response: Response): Promise<string> {
  const fallback = `Gotenberg returned HTTP ${response.status}.`
  const reader = response.body?.getReader()
  if (!reader) return fallback
  const limit = 1_500
  const prefix = new Uint8Array(limit)
  let length = 0
  try {
    while (length < limit) {
      const { done, value } = await reader.read()
      if (done) break
      const count = Math.min(value.byteLength, limit - length)
      prefix.set(value.subarray(0, count), length)
      length += count
    }
    return new TextDecoder().decode(prefix.subarray(0, length)).trim() || fallback
  } catch {
    // A broken upstream diagnostic stream must not discard the HTTP status.
    return fallback
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Gotenberg chooses PDF versus ZIP based on the number of resulting documents.
 * Keep exact media-type checks for all other routes and never accept HTML fallbacks.
 */
function allowedConversionContentTypes(
  operation: Operation,
  payload: ConversionPayload,
  files: readonly File[],
  archives: readonly File[] = [],
  archiveEntryNames: readonly string[] = [],
  forwardedStages: readonly PdfPipelineStage[] = [],
): readonly string[] {
  const routeTypes = fixedRouteResponseTypes(operation.id, payload.fields.format)
  if (routeTypes) return routeTypes
  if (operation.id === 'pdf-pipeline') return pipelineResponseTypes(forwardedStages)
  if (operation.input !== 'pdf' && forwardedStages.length) {
    const types = conversionPipelineResponseTypes(forwardedStages)
    // Generated merge/compose stages constrain the output even without a
    // custom pipeline. Otherwise keep the existing source-count checks for
    // ordinary conversions rather than allowing every PDF/ZIP response.
    if (payload.conversionStages || types.length === 1) return types
  }
  const primaryType = expectedConversionContentType(operation.output, payload.fields.format)
  if (operation.output !== 'pdf') return [primaryType]

  if (operation.id === 'office-pdf' && archives.length) {
    return ['application/pdf', 'application/zip']
  }

  const remoteDocuments = (payload.downloadFrom ?? []).filter(
    (file) => !file.embedded && !file.field,
  ).length
  // ZIP inputs have already been inspected by validateZipInputs. Count their
  // source PDFs as well as direct/remote uploads, without treating unrelated
  // archive resources as documents. Gotenberg returns ZIP for multiple
  // independent PDF results.
  const archivedPdfDocuments =
    operation.input === 'pdf' ? archiveEntryNames.filter((name) => /\.pdf$/i.test(name)).length : 0
  const multipleDocuments =
    files.length + remoteDocuments + archivedPdfDocuments > 1 &&
    ((operation.input === 'office' && payload.fields.merge !== true) ||
      (operation.input === 'pdf' && operation.id !== 'merge'))
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
function conversionResponseLength(
  header: string | null,
  maxBytes: number,
  allowEmpty = false,
): number | undefined {
  if (header === null) return undefined
  if (!/^\d+$/.test(header)) {
    throw new ProxyInputError('Gotenberg returned an invalid response length.', 502)
  }
  const length = Number(header)
  if (!Number.isSafeInteger(length)) {
    throw new ProxyInputError('Gotenberg returned an invalid response length.', 502)
  }
  if (length === 0 && !allowEmpty) {
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

/** Accept RFC-style multipart boundary quoting and optional UTF-8 charset while
 * rejecting ambiguous parameters before parsing an untrusted upload body.
 * Node's FormData parser already supports these valid MIME header variants.
 */
function supportedMultipartContentType(contentType: string): boolean {
  if (contentType.length > 512) return false
  const [mediaType, ...parameters] = contentType.split(';')
  if (mediaType?.trim().toLowerCase() !== 'multipart/form-data') return false

  let boundary = false
  let charset = false
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=')
    if (separator < 1) return false
    const name = parameter.slice(0, separator).trim().toLowerCase()
    const rawValue = parameter.slice(separator + 1).trim()
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue
    if (name === 'boundary') {
      if (boundary || !/^[A-Za-z0-9'()+_,./:=?-]{1,200}$/.test(value)) return false
      boundary = true
    } else if (name === 'charset') {
      if (charset || value.toLowerCase() !== 'utf-8') return false
      charset = true
    } else {
      return false
    }
  }
  return boundary
}

/** Every request resolves a validated destination and its authentication, without sessions. */
export async function proxyConversionRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const contentType = request.headers.get('content-type') ?? ''
  if (!supportedMultipartContentType(contentType)) {
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
  const stageFiles: File[] = []
  const archives: File[] = []
  const postFiles: PostProcessFiles = {}
  let payloadCount = 0
  for (const [key, value] of fields) {
    if (key === 'payload' && typeof value === 'string') {
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
    } else if (key === 'stageFile' && value instanceof File) {
      stageFiles.push(value)
    } else if (key === 'archives' && value instanceof File) {
      archives.push(value)
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
  validateFiles(operation, files, auxiliary, maxBytes, payload, postFiles, stageFiles, archives)
  const target = await resolveAuthenticatedConnectionTarget(
    request,
    settings,
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
    fetcher,
  )
  const { url, headers: authHeaders } = target
  const version = await conversionTargetVersion(request, fetcher, target)
  const major = version.major as SupportedGotenbergMajor
  const expected = parseGotenbergVersion(payload.expectedBackendVersion)
  if (expected && !sameGotenbergApiVersion(expected, version)) {
    throw new InputError(
      `Gotenberg changed from ${expected.major}.${expected.minor} to ${version.major}.${version.minor} since this request was configured. Refresh the connection and review the draft before running or queuing it again.`,
      409,
    )
  }
  if (!(operation.supportedGotenbergMajors ?? [8]).includes(major)) {
    throw new ProxyInputError(
      `The ${operation.title} tool is not available on Gotenberg ${major} yet.`,
      409,
    )
  }
  const versionReason = operationMinimumVersionReason(version, operation)
  if (versionReason) throw new InputError(versionReason, 409)
  const fieldReason = requestFieldCompatibilityReason(operation, version, payload.fields)
  if (fieldReason) throw new InputError(fieldReason, 409)
  const outboundReason = outboundCompatibilityReasons(operation, version, payload)[0]
  if (outboundReason)
    throw new InputError(outboundReason, outboundReason.includes('filename overrides') ? 409 : 400)
  if (
    major === 9 &&
    version.minor < 2 &&
    [
      payload.fields.pages,
      payload.fields.sourcePages,
      payload.fields.rotatePages,
      payload.fields.watermarkPages,
      payload.fields.stampPages,
      payload.fields.splitSpan,
      payload.advanced.splitSpan,
    ].some(hasGotenberg92PageSyntax)
  ) {
    throw new InputError(
      'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.',
      409,
    )
  }
  if (major === 9 && (operation.id === 'pdf-pipeline' || payload.conversionStages)) {
    const stages = parsePdfPipeline(
      operation.id === 'pdf-pipeline'
        ? String(payload.fields.stages ?? '')
        : (payload.conversionStages ?? ''),
      {
        allowEmpty: operation.id !== 'pdf-pipeline',
        acknowledgedRedaction:
          operation.id === 'pdf-pipeline'
            ? payload.fields.acknowledgedRedaction === true
            : payload.acknowledgedConversionRedaction,
      },
    )
    if (
      requiresGotenberg91ForExtraction(
        version,
        stages.map(({ op }) => op),
      )
    ) {
      throw new InputError(
        'PDF text and attachment extraction require Gotenberg 9.1 or newer.',
        409,
      )
    }
    if (
      requiresGotenberg92ForComposition(
        version,
        stages.map(({ op }) => op),
      )
    ) {
      throw new InputError('PDF page composition requires Gotenberg 9.2 or newer.', 409)
    }
    if (requiresGotenberg94ForStampPosition(version, stages)) {
      throw new InputError('Anchored PDF stamps require Gotenberg 9.4 or newer.', 409)
    }
    if (
      requiresGotenberg95ForPaperSize(
        version,
        stages.filter(({ op }) => op === 'compose').map(({ paperSize }) => paperSize),
      )
    ) {
      throw new InputError('A0, A1 and A2 paper sizes require Gotenberg 9.5 or newer.', 409)
    }
    if (requiresGotenberg96ForSignatureDrop(version, stages)) {
      throw new InputError('Removing digital signatures requires Gotenberg 9.6 or newer.', 409)
    }
    if (requiresGotenberg97ForFileBookmarks(version, stages)) {
      throw new InputError('Per-file merge bookmarks require Gotenberg 9.7 or newer.', 409)
    }
    if (requiresGotenberg98ForExtractTextFormat(version, stages)) {
      throw new InputError('Extraction formats require Gotenberg 9.8 or newer.', 409)
    }
    if (requiresGotenberg99ForCompressStreams(version, stages)) {
      throw new InputError('PDF stream compression control requires Gotenberg 9.9 or newer.', 409)
    }
    if (major === 9 && version.minor < 2 && stagesUseGotenberg92PageSyntax(stages)) {
      throw new InputError(
        'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.',
        409,
      )
    }
  }
  // The first preflight permits version-dependent inputs (Office formats,
  // single-PDF merges, named XML/PDF assets). Recheck all file contracts once
  // the authenticated server's actual major version is known.
  validateFiles(
    operation,
    files,
    auxiliary,
    maxBytes,
    payload,
    postFiles,
    stageFiles,
    archives,
    major,
  )
  if (archives.length && major !== 9) {
    throw new InputError('ZIP archive inputs require Gotenberg 9.')
  }
  // ZIPs are still extracted and checked by Gotenberg. Before forwarding,
  // inspect only their bounded directory metadata to catch wrong source types,
  // collisions with generated documents, and invalid ZIP structures.
  const archiveEntryNames = archives.length
    ? await validateZipInputs(operation, payload, files, auxiliary, stageFiles, archives)
    : []
  if (major === 9 && postFiles.embeds?.length) {
    throw new InputError(
      'Gotenberg 9 does not accept the legacy embeds field. Use an attach stage with a named pipeline stage file, or use a Gotenberg 8 connection.',
    )
  }
  const legacy = createGotenbergForm(
    operation,
    payload,
    files,
    auxiliary,
    maxBytes,
    postFiles,
    archives,
    major,
    version,
    stageFiles,
    archiveEntryNames,
  )
  const { path, form } =
    operation.input === 'pdf'
      ? adaptPdfForm(operation, payload, legacy, major, auxiliary, archives, archiveEntryNames)
      : {
          path: operation.path,
          form: adaptConversionForm(
            operation,
            payload,
            legacy,
            major,
            stageFiles,
            archives,
            archiveEntryNames,
          ),
        }
  if (major === 9) {
    validateAssetFilenameRegistration(form, archiveEntryNames, path.startsWith('/forms/chromium/'))
  }
  const forwardedStages =
    major === 9 ? (JSON.parse(String(form.get('stages') ?? '[]')) as PdfPipelineStage[]) : []
  if (major === 9 && (operation.input === 'pdf' || operation.input === 'office')) {
    // Count the actual multipart inputs, not hints or all downloaded resources.
    const downloads = JSON.parse(String(form.get('downloadFrom') ?? '[]')) as {
      filename?: string
    }[]
    const names = [
      ...form.getAll('files').flatMap((entry) => (entry instanceof File ? [entry.name] : [])),
      ...archiveEntryNames,
      ...downloads.map(({ filename }) => filename || undefined),
    ]
    const reason = sourceDocumentReason(
      operation.input,
      names,
      new Set(pdfStageAssetNames(forwardedStages)),
    )
    if (reason) throw new InputError(reason)
  }
  const extractsAttachment = isStandaloneAttachmentExtraction(
    operation.id,
    payload.fields.stages,
    payload.fields.acknowledgedRedaction === true,
  )
  const upstream = await fetcher(joinURL(url, path), {
    method: 'POST',
    ...fetchOptions(request),
    body: multipartBody(form),
    // Gotenberg's output filename override also renames a lone extracted
    // attachment. Keep its original name and only override generated outputs.
    headers: upstreamConversionHeaders(
      authHeaders,
      payload,
      operation.output !== 'json' && !extractsAttachment,
      major,
    ),
    credentials: 'omit',
  })
  // A deployment can be upgraded or its load balancer can switch backends after
  // /version was probed. Gotenberg advertises its actual version on responses;
  // never return a successful file or webhook acceptance from the wrong adapter.
  // Absent headers are tolerated for proxies that strip diagnostic headers.
  if (upstream.ok) {
    const returnedVersion = upstream.headers.get('Gotenberg-Version')
    if (returnedVersion !== null) {
      const parsed = parseGotenbergVersion(returnedVersion)
      if (!parsed || !sameGotenbergApiVersion(parsed, version)) {
        await upstream.body?.cancel().catch(() => {})
        const detail = !parsed
          ? 'Gotenberg returned an invalid version header.'
          : parsed.major !== major
            ? `Gotenberg changed from v${major} to v${parsed.major} during conversion.`
            : `Gotenberg changed from ${major}.${version.minor} to ${parsed.major}.${parsed.minor} during conversion.`
        const accepted = upstream.status === 202 || upstream.status === 204
        throw new ProxyInputError(
          accepted
            ? `${detail} The asynchronous job may already have been accepted; check its callbacks before retrying.`
            : `${detail} Refresh the connection and retry.`,
          accepted ? 502 : parsed ? 409 : 502,
        )
      }
    }
  }
  if (!upstream.ok) {
    invalidateUnauthorized(upstream.status, target)
    const headers = new Headers({
      ...safeResponseHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
    })
    copyUpstreamDiagnostics(upstream, headers)
    const detail = await upstreamErrorText(upstream)
    return new Response(describePdfUpstreamError(version, path, upstream.status, detail), {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers,
    })
  }
  const headers = new Headers(safeResponseHeaders)
  copyUpstreamDiagnostics(upstream, headers)
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
  const allowedTypes = allowedConversionContentTypes(
    operation,
    payload,
    files,
    archives,
    archiveEntryNames,
    forwardedStages,
  )
  const upstreamContentType = upstream.headers.get('content-type')
  const returnedType = responseMediaType(upstreamContentType)
  // An extracted attachment has its own MIME type, which may be anything.
  // Require an actual filename-bearing attachment response before accepting it,
  // so an HTML SPA fallback can never be mistaken for a successful extraction.
  const attachmentDisposition = upstream.headers.get('content-disposition')
  const wildcardAllowed =
    allowedTypes.includes('*') && isNamedAttachmentResponse(returnedType, attachmentDisposition)
  if (
    upstream.status !== 200 ||
    !returnedType ||
    !(allowedTypes.includes(returnedType) || wildcardAllowed) ||
    !upstream.body
  ) {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg returned an unexpected conversion response.', 502)
  }
  // A scanned PDF may contain no extractable text. A single extracted file
  // can itself have a .zip extension, without containing ZIP-format bytes.
  // Only the filename-bearing attachment response may bypass the signature
  // and nonempty-body checks. Other ZIP responses still require a signature.
  const arbitraryAttachment = extractsAttachment && wildcardAllowed
  const allowEmptyResponse =
    arbitraryAttachment ||
    ((returnedType === 'text/plain' || returnedType === 'text/markdown') &&
      allowedTypes.includes(returnedType))
  let declaredLength: number | undefined
  try {
    // Fetch decodes compressed upstream responses but leaves their compressed
    // Content-Length header intact. Always limit decoded stream bytes instead.
    const contentEncoding = upstream.headers.get('content-encoding')
    if (!contentEncoding || contentEncoding.toLowerCase() === 'identity') {
      declaredLength = conversionResponseLength(
        upstream.headers.get('content-length'),
        maxResponseBytes,
        allowEmptyResponse,
      )
    }
  } catch (error) {
    await upstream.body.cancel().catch(() => {})
    throw error
  }
  const checkedBody = await verifyConversionSignature(
    upstream.body,
    arbitraryAttachment ? 'application/octet-stream' : returnedType,
    declaredLength,
    {
      // Incremental edits and single-document merges can keep the original
      // PDF header. Full rewrites must still return an immediate header.
      allowPdfPreamble:
        major === 9 &&
        returnedType === 'application/pdf' &&
        path === '/forms/pdf/pipe' &&
        pipelineMayPreservePdfHeader(forwardedStages),
    },
  )
  headers.set('Content-Type', upstreamContentType ?? returnedType)
  headers.set(
    'Content-Disposition',
    safeAttachmentDisposition(
      upstream.headers.get('content-disposition'),
      operation.id,
      returnedType,
      payload.outputName,
      arbitraryAttachment,
    ),
  )
  return new Response(
    limitResponseStream(checkedBody, maxResponseBytes, declaredLength, allowEmptyResponse),
    {
      status: 200,
      headers,
    },
  )
}

/** A compact JSON status response for the browser, with no browser-to-Gotenberg fetches. */
export async function proxyStatusRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const search = new URL(request.url).searchParams
  const target = await resolveAuthenticatedConnectionTarget(
    request,
    runtimeConfig(),
    search.get('url'),
    search.get('connection'),
    fetcher,
  )
  const { url, headers: authHeaders } = target
  const options = {
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit' as const,
  }
  let status: ServerStatus
  try {
    const health = await fetcher(joinURL(url, '/health'), options)
    if (health.status !== 200) {
      invalidateUnauthorized(health.status, target)
      await health.body?.cancel().catch(() => {})
      throw new StatusProbeError(`Gotenberg returned HTTP ${health.status}.`)
    }
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
      const response = await fetcher(joinURL(url, '/version'), options)
      if (response.status === 401 || response.status === 403) {
        invalidateUnauthorized(response.status, target)
        versionAuthFailure = response.status
        await response.body?.cancel().catch(() => {})
      } else if (response.status === 200) {
        const reported = (await boundedStatusText(response, 1_024)).trim()
        // Never turn a truncated version into a valid API version.
        if (reported && reported.length <= MAX_GOTENBERG_VERSION_LENGTH) version = reported
      } else {
        // The optional version probe must not retain an unread upstream response.
        await response.body?.cancel().catch(() => {})
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
  const target = await resolveAuthenticatedConnectionTarget(
    request,
    runtimeConfig(),
    search.get('url'),
    search.get('connection'),
    fetcher,
  )
  const { url, headers: authHeaders } = target
  const upstream = await fetcher(joinURL(url, '/health'), {
    method: 'HEAD',
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit',
  })
  // Gotenberg reports 200 or 503. Forward an authentication failure for diagnostic
  // purposes; unexpected responses are gateway errors, not healthy probes.
  invalidateUnauthorized(upstream.status, target)
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
  const settings = runtimeConfig()
  const profileId = request.headers.get('x-gotenui-connection-id')
  const profile =
    profileId === null ? undefined : requireServerConnection(profileId, settings.connections)
  // Separate OTEL exporters must not trigger token acquisition for Gotenberg.
  const isOtel = Boolean(profile?.metricsUrl)
  const target = await resolveAuthenticatedConnectionTarget(
    request,
    settings,
    request.headers.get('x-gotenberg-url'),
    profileId,
    fetcher,
    !isOtel,
  )
  const { url, headers: authHeaders } = target
  if (!isOtel && (await conversionTargetVersion(request, fetcher, target)).major === 9) {
    throw new ProxyInputError(
      'Gotenberg 9 no longer serves /prometheus/metrics. Configure a server-managed connection with a separate OpenTelemetry Prometheus metricsUrl.',
      409,
    )
  }
  const metricsUrl = profile?.metricsUrl ?? joinURL(url, '/prometheus/metrics')
  const metricsHeaders = isOtel
    ? profile?.metricsAuthorization
      ? { Authorization: profile.metricsAuthorization }
      : undefined
    : authHeaders
  const upstream = await fetcher(metricsUrl, {
    method: 'GET',
    ...fetchOptions(request),
    headers: metricsHeaders,
    credentials: 'omit',
  })
  if (upstream.status !== 200) {
    if (!isOtel) invalidateUnauthorized(upstream.status, target)
    await upstream.body?.cancel().catch(() => {})
    const message =
      upstream.status === 404
        ? isOtel
          ? 'The configured OpenTelemetry /metrics exporter endpoint is unavailable.'
          : 'The legacy Gotenberg Prometheus endpoint is unavailable. Configure a server-managed OpenTelemetry metricsUrl instead.'
        : upstream.status === 401 || upstream.status === 403
          ? 'The configured metrics endpoint rejected authentication.'
          : `Metrics endpoint returned HTTP ${upstream.status}.`
    return new Response(message, {
      status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      headers: { ...safeResponseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const MAX_METRICS_RESPONSE_BYTES = 2_000_000
  const contentType = responseMediaType(upstream.headers.get('content-type'))
  if (contentType !== 'text/plain' && contentType !== 'application/openmetrics-text') {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg metrics did not return Prometheus text.', 502)
  }
  if (!upstream.body) {
    throw new ProxyInputError('Gotenberg returned an empty metrics response.', 502)
  }
  const bytes = await boundedProxyDiagnosticBody(
    upstream,
    MAX_METRICS_RESPONSE_BYTES,
    'metrics',
    '2 MB',
  )
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
      'X-Gotenui-Metrics-Source': isOtel ? 'otel' : 'legacy',
    },
  })
}

/** The selected Gotenberg instance controls access to its optional debug route. */
export async function proxyDebugRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  requireSameOrigin(request)
  const target = await resolveAuthenticatedConnectionTarget(
    request,
    runtimeConfig(),
    request.headers.get('x-gotenberg-url'),
    request.headers.get('x-gotenui-connection-id'),
    fetcher,
  )
  const { url, headers: authHeaders } = target
  const upstream = await fetcher(joinURL(url, '/debug'), {
    method: 'GET',
    ...fetchOptions(request),
    headers: authHeaders,
    credentials: 'omit',
  })
  if (upstream.status !== 200) {
    invalidateUnauthorized(upstream.status, target)
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
  if (responseMediaType(upstream.headers.get('content-type')) !== 'application/json') {
    await upstream.body?.cancel().catch(() => {})
    throw new ProxyInputError('Gotenberg debug did not return JSON.', 502)
  }
  if (!upstream.body) throw new ProxyInputError('Gotenberg returned an empty debug response.', 502)

  const bytes = await boundedProxyDiagnosticBody(
    upstream,
    MAX_DEBUG_RESPONSE_BYTES,
    'debug',
    '1 MB',
  )
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
