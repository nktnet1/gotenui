import {
  chromiumNames,
  officeNames,
  v9NativeConversionReason,
} from '#/lib/gotenberg-conversion-adapter'
import type { GotenbergVersion } from '#/lib/gotenberg-version'
import { canWebhookForOperation } from '#/lib/operation-availability'
import { pdfValidationProfileIssue } from '#/lib/pdf-conformance-profiles'
import { composeStageFromFields, conversionSplitStage, parsePdfPipeline } from '#/lib/pdf-pipeline'
import { pdfPostProcessSchema } from '#/lib/pdf-post-processing'
import { validateBookmarkDocument } from '#/lib/pdf-structure-editors'
import { v9BookmarkTree, v9MetadataFields } from '#/lib/pdf-v9-structure'
import type { ConversionPayload } from '#/lib/validation'
import { fieldCompatibilityReason } from '#/tools/shared/field-visibility'
import type { Operation } from '#/tools/types'

/** The proxy retains the documented legacy conformance aliases which its adapters translate. */
export function requestFieldCompatibilityReason(
  operation: Operation,
  version: GotenbergVersion,
  fields: ConversionPayload['fields'],
): string | null {
  for (const field of operation.fields) {
    const value = fields[field.name]
    if (value === undefined || value === '') continue
    // Disabled legacy opt-ins are no-ops. Tracked changes is an explicit native boolean.
    if (value === false && field.defaultValue !== true && field.name !== 'showTrackedChanges')
      continue
    if (
      version.major === 9 &&
      field.supportedGotenbergMajors?.includes(8) &&
      ['pdfa', 'pdfua'].includes(field.name)
    )
      continue
    const reason = fieldCompatibilityReason(
      field,
      `${version.major}.${version.minor}.${version.patch}`,
      value,
    )
    if (reason) return reason
  }
  return null
}

// These legacy multipart options are handled by PDF stages in v9, not by the
// native conversion routes. Keep arbitrary future Advanced JSON keys available.
const legacyPostProcessFields = new Set([
  ...Object.keys(pdfPostProcessSchema.entries),
  ...['watermark', 'stamp'].flatMap((kind) =>
    ['Source', 'Expression', 'Pages', 'Options'].map((suffix) => `${kind}${suffix}`),
  ),
  'bookmarks',
  'autoIndexBookmarks',
  'titleBookmarks',
])

// Native aliases are route-specific even when their legacy spelling is shared.
const nativeConversionAliases = new Set<string>([
  ...Object.values(chromiumNames),
  ...Object.values(officeNames),
  'nativePdfa',
  'nativePdfua',
])

function advancedCompatibilityReasons(
  operation: Operation,
  version: GotenbergVersion,
  payload: Pick<ConversionPayload, 'advanced' | 'fields'>,
): string[] {
  const { advanced, fields } = payload
  if (version.major === 9 && operation.input === 'pdf' && Object.keys(advanced).length) {
    return [
      'Gotenberg 8 advanced PDF fields cannot be passed to Gotenberg 9. Use the supported tool settings or PDF pipeline editor.',
    ]
  }
  const office = operation.id === 'office-pdf'
  const chromium = operation.path.startsWith('/forms/chromium/')
  const renamedFields: Readonly<Record<string, string>> = office
    ? officeNames
    : chromium
      ? chromiumNames
      : {}
  const nativeFields = new Set<string>(
    Object.entries(renamedFields)
      .filter(([legacy]) => operation.fields.some((field) => field.name === legacy))
      .map(([, native]) => native),
  )
  if (office) {
    nativeFields.add('nativePdfa')
    nativeFields.add('nativePdfua')
  }
  const reasons: string[] = []
  if (version.major === 9) {
    const reason = v9NativeConversionReason(operation, payload)
    if (reason) reasons.push(reason)
  }
  if (
    version.major === 9 &&
    (operation.id === 'split' || ((office || chromium) && operation.output === 'pdf'))
  ) {
    try {
      const split = conversionSplitStage(
        String(advanced.splitMode ?? fields.splitMode ?? ''),
        String(advanced.splitSpan ?? fields.splitSpan ?? ''),
        advanced.splitUnify ?? fields.splitUnify ?? false,
      )
      if (split) parsePdfPipeline(JSON.stringify([split]), {})
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : 'Invalid split settings.')
    }
  }
  for (const [name, value] of Object.entries(advanced)) {
    if (value === '') continue
    if (nativeConversionAliases.has(name) && !nativeFields.has(name)) {
      reasons.push(`Advanced field ${name} is not supported for ${operation.title}.`)
    } else if (version.major === 8 && nativeFields.has(name)) {
      reasons.push(
        `Advanced field ${name} requires Gotenberg 9. Use the corresponding tool setting instead.`,
      )
    } else if (version.major === 9 && (office || chromium)) {
      if (name === 'stages') {
        reasons.push('Advanced stages require the Gotenberg 9 PDF pipeline editor.')
      } else if (legacyPostProcessFields.has(name)) {
        reasons.push(`Advanced field ${name} requires a PDF stage on Gotenberg 9.`)
      }
      for (const [legacy, native] of Object.entries(renamedFields)) {
        if (name === native && fields[legacy] !== undefined && fields[legacy] !== '') {
          reasons.push(`Use either ${legacy} or ${native}, not both.`)
        }
      }
    }
  }
  return reasons
}

/** Shared preflight for outbound settings that do not belong to the route field definitions. */
export function outboundCompatibilityReasons(
  operation: Operation,
  version: GotenbergVersion,
  payload: Pick<ConversionPayload, 'downloadFrom' | 'webhook' | 'advanced' | 'fields'>,
): string[] {
  const reasons: string[] = []
  const modern = version.major === 9
  const supportsFilename = modern && version.minor >= 2
  if (!supportsFilename && payload.downloadFrom?.some((remote) => remote.filename)) {
    reasons.push('downloadFrom filename overrides require Gotenberg 9.2 or newer.')
  }
  if (modern && payload.downloadFrom?.some((remote) => remote.embedded || remote.field)) {
    reasons.push(
      'Gotenberg 9 treats remote downloads as ordinary files. Remote attachment and overlay destinations require named PDF pipeline files.',
    )
  }
  if (modern && payload.webhook) {
    if (!canWebhookForOperation(version.major, operation)) {
      reasons.push(
        'Gotenberg 9 PDF inspection tools return JSON directly and cannot deliver results through a webhook.',
      )
    }
    if (!payload.webhook.eventsUrl)
      reasons.push('Gotenberg 9 webhooks require an events callback URL.')
    if (payload.webhook.errorUrl || payload.webhook.errorMethod)
      reasons.push('Gotenberg 9 removed the separate webhook error callback.')
  }
  if (modern && operation.id === 'pdf-validate') {
    const issue = pdfValidationProfileIssue(payload.fields)
    if (issue) reasons.push(issue)
  }
  // Match the standalone adapters before users submit or queue a retained draft.
  try {
    if (modern && operation.id === 'compose-pages') {
      composeStageFromFields(payload.fields)
    }
    if (modern && operation.id === 'metadata-write' && payload.fields.metadata) {
      v9MetadataFields(String(payload.fields.metadata))
    }
    if (operation.id === 'bookmarks-write' && payload.fields.bookmarks) {
      const raw = String(payload.fields.bookmarks)
      if (modern) v9BookmarkTree(raw)
      else validateBookmarkDocument(raw)
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'Invalid PDF structure.')
  }
  reasons.push(...advancedCompatibilityReasons(operation, version, payload))
  return reasons
}
