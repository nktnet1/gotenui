import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'
import {
  DEFAULT_MARKDOWN_NAME,
  defaultMarkdownTemplate,
  generatedChromiumFilenames,
} from '#/lib/chromium-documents'
import {
  CHROMIUM_MEDIA_OPTIONS,
  encodeChromiumMediaFeatures,
  normalizeAdvancedMediaFeatures,
} from '#/lib/chromium-media'
import { encodeChromiumCookies } from '#/lib/chromium-network'
import { type ConnectionChoice, requireConnectionCredentials } from '#/lib/connection-profiles'
import { conversionRequestBody } from '#/lib/conversion-request-body'
import {
  expectedConversionContentType,
  fixedRouteResponseTypes,
  isNamedAttachmentResponse,
} from '#/lib/conversion-response'
import {
  CHROMIUM_REMOTE_FILENAME_VERSION_REASON,
  filenameKey,
  planRemoteFilenames,
  remoteFilenamePlanReason,
} from '#/lib/file-names'
import type { GotenbergVersion, SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { mergeBookmarks, mergeUploadFilename } from '#/lib/merge-order'
import { encodeOfficialField } from '#/lib/official-form-fields'
import {
  conversionPipelineResponseTypes,
  isStandaloneAttachmentExtraction,
  parsePdfPipeline,
  pdfStageAssetNames,
  pipelineResponseTypes,
} from '#/lib/pdf-pipeline'
import {
  OVERLAY_KINDS,
  orderedOverlayUploads,
  overlayUploads,
  type PostProcessFiles,
  postProcessFormFields,
} from '#/lib/pdf-post-processing'
import { validatePinnedRequestCompatibility } from '#/lib/request-compatibility'
import { hasAttachmentPreviewSignature } from '#/lib/response-signature'
import {
  downloadFilename,
  responseExtension,
  responseMediaType,
  safeAttachmentDisposition,
} from '#/lib/security'
import {
  type ConversionPayload,
  InputError,
  validateFiles,
  validatePayload,
} from '#/lib/validation'
import type { Operation } from '#/tools/registry'
import { fieldCompatibilityReason } from '#/tools/shared/field-visibility'

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
  requireConnectionCredentials(connection)
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
  try {
    const { headers, params } = statusTarget(connection)
    const response = await fetch(`/api/gotenberg/status?${params}`, {
      headers,
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
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
    if (
      response.status !== 200 ||
      responseMediaType(response.headers.get('content-type')) !== 'application/json'
    ) {
      await response.body?.cancel().catch(() => {})
      throw new Error('The API did not return a valid Gotenberg status.')
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
      redirect: 'error',
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
  archives: readonly File[] = [],
  major?: SupportedGotenbergMajor,
  version?: GotenbergVersion,
  stageFiles: readonly File[] = [],
  archiveEntryNames: readonly string[] = [],
): FormData {
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
  const form = new FormData()
  const isChromium = operation.path.startsWith('/forms/chromium/')
  const mediaFieldNames = new Set<string>(CHROMIUM_MEDIA_OPTIONS.map((feature) => feature.name))
  for (const [key, value] of Object.entries({ ...payload.fields, ...payload.advanced })) {
    if (mediaFieldNames.has(key)) continue // UI-only controls are encoded as a single JSON object.

    if (value === '') continue
    const definition = operation.fields.find((field) => field.name === key)
    if (
      value === false &&
      definition &&
      version &&
      definition.defaultValue !== true &&
      fieldCompatibilityReason(
        definition,
        `${version.major}.${version.minor}.${version.patch}`,
        value,
      )
    ) {
      // An unsupported disabled opt-in is a no-op, not an unknown upstream key.
      continue
    }
    // Gotenberg keys per-input bookmarks by the uploaded filename.
    const encoded =
      operation.id === 'merge' && key === 'bookmarks'
        ? mergeBookmarks(
            String(value),
            files.map((file) => file.name),
          )
        : String(value)
    // The legacy LibreOffice encoder expects tenths of a degree, whereas
    // Gotenberg 9 parses arbitrary finite degree values itself.
    form.set(
      key,
      isChromium && key === 'cookies'
        ? encodeChromiumCookies(encoded)
        : major === 9 && key === 'nativeWatermarkRotateAngle'
          ? encoded
          : encodeOfficialField(definition, encoded),
    )
  }
  if (isChromium) {
    const mediaFeatures = encodeChromiumMediaFeatures(payload.fields)
    if (mediaFeatures) form.set('emulatedMediaFeatures', mediaFeatures)
    else if (typeof payload.advanced.emulatedMediaFeatures === 'string') {
      form.set(
        'emulatedMediaFeatures',
        normalizeAdvancedMediaFeatures(payload.advanced.emulatedMediaFeatures),
      )
    }
  }
  if (payload.downloadFrom?.length) {
    // 9.2 adds filename to the official downloadFrom descriptor. The previous
    // name hint remains client-only on older servers, preserving their API.
    const supportsFilename = major === 9 && version?.major === 9 && version.minor >= 2
    // Gotenberg registers remote downloads before local files, ZIP entries,
    // and conversion-stage assets. Pin names that can shadow local assets on
    // v9.2+. Older PDF/Office workflows must retain their existing remote
    // semantics because 9.1 does not support the filename override.
    const stagesJson =
      operation.id === 'pdf-pipeline' ? payload.fields.stages : payload.conversionStages
    const stages =
      (supportsFilename || (major === 9 && isChromium)) && typeof stagesJson === 'string'
        ? parsePdfPipeline(stagesJson, {
            allowEmpty: operation.id !== 'pdf-pipeline',
            acknowledgedRedaction:
              operation.id === 'pdf-pipeline'
                ? payload.fields.acknowledgedRedaction === true
                : payload.acknowledgedConversionRedaction,
          })
        : []
    const chromiumNamesAtRisk =
      major === 9 &&
      isChromium &&
      (generatedChromiumFilenames(operation.input, payload).length > 0 ||
        files.length > 0 ||
        auxiliary.length > 0 ||
        archives.length > 0 ||
        stages.length > 0)
    const stageAssetNames = new Set(supportsFilename ? pdfStageAssetNames(stages) : [])
    const namedArchiveAssets = archiveEntryNames.some((name) =>
      stageAssetNames.has(filenameKey(name)),
    )
    // Pin preceding downloads too: their registered names must not displace
    // a later named remote stage asset or explicit Chromium resource.
    const filenamePlan = planRemoteFilenames(payload.downloadFrom, {
      supportsFilename,
      inferAll: files.length > 0 || archives.length > 0,
      pinAll:
        chromiumNamesAtRisk || auxiliary.length > 0 || stageFiles.length > 0 || namedArchiveAssets,
      stageAssetNames,
      protectNamedRemotes: major === 9 && isChromium,
    })
    if (chromiumNamesAtRisk && !supportsFilename) {
      throw new InputError(CHROMIUM_REMOTE_FILENAME_VERSION_REASON, 409)
    }
    const filenameReason = remoteFilenamePlanReason(filenamePlan)
    if (filenameReason) throw new InputError(filenameReason)
    form.set(
      'downloadFrom',
      JSON.stringify(
        payload.downloadFrom.map(({ name, filename, ...remote }, index) => {
          if (filename && !supportsFilename) {
            throw new InputError(
              'downloadFrom filename overrides require Gotenberg 9.2 or newer.',
              409,
            )
          }
          const effectiveFilename = filenamePlan[index]?.name
          return {
            ...remote,
            ...(supportsFilename && effectiveFilename ? { filename: effectiveFilename } : {}),
          }
        }),
      ),
    )
  }
  if (operation.input === 'html' || operation.input === 'markdown') {
    const markdownNames = [
      (payload.markdownName ?? DEFAULT_MARKDOWN_NAME).normalize('NFC'),
      ...(payload.markdownFiles ?? []).map((file) => file.name.normalize('NFC')),
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
        form.append(
          'files',
          new File([file.content], file.name.normalize('NFC'), { type: 'text/markdown' }),
        )
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

export const WEBHOOK_NOT_ACCEPTED_NOTICE =
  'Gotenberg returned a synchronous download instead of webhook acceptance. Delivery is not confirmed. Check the receivers before retrying.'

export type RemediationReport = { residual: number; rolledBack: number; incomplete?: boolean }

export type ConversionResult =
  | {
      mode: 'download'
      blob: Blob
      type: string
      name: string
      trace?: string
      remediation?: RemediationReport
      /** An extracted file can have a misleading MIME type or no bytes at all. */
      attachment?: true
    }
  | { mode: 'webhook'; trace?: string; status: 202 | 204 }

/** Optional binary previews of extracted attachments require a matching signature.
 * Never reject an attachment download because its original bytes are unusual.
 */
export async function conversionBinaryPreviewAllowed(
  result: Extract<ConversionResult, { mode: 'download' }>,
): Promise<boolean> {
  if (!result.attachment) return true
  try {
    return await hasAttachmentPreviewSignature(result.blob, result.type)
  } catch {
    return false
  }
}

/** Keep text previews bounded and render them as text, never as HTML. */
export async function conversionTextPreview(blob: Blob, type: string): Promise<string | undefined> {
  if (!['application/json', 'text/plain', 'text/markdown'].includes(type)) return undefined
  try {
    return await blob.slice(0, 16_000).text()
  } catch {
    // An optional local preview must not prevent downloading the original Blob.
    return undefined
  }
}

/** The proxy checks the exact output count after adapting the request. The
 * browser also checks the response envelope, without guessing that count.
 */
export function browserResponseTypes(
  operation: Operation,
  payload: ConversionPayload,
): readonly string[] {
  const { fields } = payload
  const routeTypes = fixedRouteResponseTypes(operation.id, fields.format)
  if (routeTypes) return routeTypes
  if (operation.id === 'pdf-pipeline')
    return pipelineResponseTypes(
      parsePdfPipeline(String(fields.stages ?? ''), {
        acknowledgedRedaction: fields.acknowledgedRedaction === true,
      }),
    )
  if (operation.output === 'pdf' && payload.conversionStages)
    return conversionPipelineResponseTypes(
      parsePdfPipeline(payload.conversionStages, {
        allowEmpty: true,
        acknowledgedRedaction: payload.acknowledgedConversionRedaction,
      }),
    )
  if (operation.output === 'pdf') return ['application/pdf', 'application/zip']
  return [expectedConversionContentType(operation.output, fields.format)]
}

/** The proxy revalidates the JSON and files, and reconstructs a safe Gotenberg form. */
export async function convertWithGotenberg(
  connection: string | ConnectionChoice,
  candidate: unknown,
  files: File[],
  auxiliary: File[],
  signal: AbortSignal,
  postFiles: PostProcessFiles = {},
  stageFiles: File[] = [],
  archives: File[] = [],
): Promise<ConversionResult> {
  const headers = targetHeaders(connection)
  const { operation, payload } = validatePayload(candidate)
  // Keep fast client-side feedback; all fields and files are checked again by the server.
  validateFiles(
    operation,
    files,
    auxiliary,
    MAX_UPLOAD_BYTES,
    payload,
    postFiles,
    stageFiles,
    archives,
    validatePinnedRequestCompatibility(operation, payload),
  )
  const allowedTypes = browserResponseTypes(operation, payload)
  const body = conversionRequestBody(payload, files, auxiliary, postFiles, stageFiles, archives)
  let response: Response
  try {
    response = await fetch('/api/gotenberg/convert', {
      method: 'POST',
      body,
      signal,
      credentials: 'same-origin',
      redirect: 'error',
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
    await response.body?.cancel().catch(() => {})
    if (!payload.webhook)
      throw new Error('The Gotenui API returned asynchronous acceptance without a webhook.')
    return {
      mode: 'webhook',
      trace: response.headers.get('Gotenberg-Trace') ?? undefined,
      status: response.status as 202 | 204,
    }
  }
  const type = responseMediaType(response.headers.get('content-type'))
  const disposition = response.headers.get('content-disposition')
  if (
    response.status !== 200 ||
    !type ||
    !response.body ||
    !(
      allowedTypes.includes(type) ||
      (allowedTypes.includes('*') && isNamedAttachmentResponse(type, disposition))
    )
  ) {
    await response.body?.cancel().catch(() => {})
    throw new Error(
      'The Gotenui API returned an unexpected conversion response. Check the Nitro deployment.',
    )
  }
  const blob = await response.blob()
  const extension = responseExtension(type)
  // The proxy has already chosen a safe filename for the actual output type.
  // Use that filename even with an explicit outputName: a conversion that asks
  // for report.pdf can legitimately return a ZIP of PDFs or rendered images.
  const fallback = `${operation.id}.${extension}`
  const extractsAttachment = isStandaloneAttachmentExtraction(
    operation.id,
    payload.fields.stages,
    payload.fields.acknowledgedRedaction === true,
  )
  const filename = downloadFilename(
    safeAttachmentDisposition(
      response.headers.get('content-disposition'),
      operation.id,
      type,
      payload.outputName,
      // Only direct attachment results retain their upstream filenames.
      // Multi-stage and conversion-time extraction return generated archives.
      extractsAttachment,
    ),
    fallback,
  )
  return {
    mode: 'download',
    blob,
    type,
    name: filename,
    trace: response.headers.get('Gotenberg-Trace') ?? undefined,
    remediation: readRemediationReport(response.headers),
    ...(extractsAttachment ? { attachment: true as const } : {}),
  }
}

/** Gotenberg 9 may return HTTP 200 with unresolved conformance violations. */
function readRemediationReport(headers: Headers): RemediationReport | undefined {
  const residual = headers.get('Gotenberg-Remediation-Residual')
  const rolledBack = headers.get('Gotenberg-Remediation-Rolled-Back')
  if (
    residual === null &&
    rolledBack === null &&
    headers.get('Gotenui-Remediation-Incomplete') !== '1'
  )
    return undefined
  if (
    headers.get('Gotenui-Remediation-Incomplete') === '1' ||
    residual === null ||
    rolledBack === null ||
    !/^\d{1,10}$/.test(residual) ||
    !/^\d{1,10}$/.test(rolledBack)
  ) {
    return { residual: 0, rolledBack: 0, incomplete: true }
  }
  return { residual: Number(residual), rolledBack: Number(rolledBack) }
}

/** Summaries are warnings, never proof of compliance from a successful HTTP response. */
export function remediationReviewNotice(report: RemediationReport | undefined): string | undefined {
  if (!report) return undefined
  if (report.incomplete) {
    return 'PDF remediation diagnostics were incomplete. Validate the downloaded output.'
  }
  if (report.residual > 0 || report.rolledBack > 0) {
    return `PDF remediation reported ${report.residual} unresolved violation(s) and ${report.rolledBack} rolled-back fix(es). Validate the downloaded output.`
  }
  return undefined
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
      redirect: 'error',
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
  if (
    response.status !== 200 ||
    responseMediaType(response.headers.get('content-type')) !== 'application/json'
  ) {
    await response.body?.cancel().catch(() => {})
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
      redirect: 'error',
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
    response.status !== 200 ||
    response.headers.get('x-gotenui-metrics') !== '1' ||
    responseMediaType(response.headers.get('content-type')) !== 'text/plain'
  ) {
    await response.body?.cancel().catch(() => {})
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
