import {
  type RemoteInputRow,
  remoteInputsPayload,
  type WebhookEditorState,
  webhookPayload,
} from '#/lib/async-inputs'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import type { PdfPostProcess, PostProcessFiles } from '#/lib/pdf-post-processing'
import { countPostProcessFiles } from '#/lib/pdf-post-processing'
import { outboundCompatibilityReasons } from '#/lib/request-compatibility'
import {
  parseAdvanced,
  validateAdvancedParameters,
  validateAsyncInputValues,
} from '#/lib/validation'
import { activeOperationFields, incompatibleOperationFields } from '#/tools/shared/field-visibility'
import type { Operation } from '#/tools/types'

/** Everything that would otherwise be omitted by the selected backend's form adapter. */
export function draftCompatibility(
  operation: Operation,
  fields: Readonly<Record<string, string | boolean>>,
  backendVersion: string | undefined,
  draft: {
    legacyStandaloneOverlay: boolean
    acceptsPostProcess: boolean
    postProcess: PdfPostProcess
    postFiles: PostProcessFiles
    acceptsArchives: boolean
    archives: readonly File[]
    acceptsWebhook: boolean
    webhookConfigured: boolean
    acceptsConversionStages: boolean
    conversionStages: string
    conversionStageFiles: readonly File[]
    auxiliary: readonly File[]
  },
) {
  const version = parseGotenbergVersion(backendVersion)
  const confirmed = version?.major === 8 || version?.major === 9
  const fieldConflicts = incompatibleOperationFields(
    operation,
    fields,
    backendVersion,
    draft.legacyStandaloneOverlay,
  )
  const discardPostProcess =
    confirmed &&
    !draft.acceptsPostProcess &&
    (Object.values(draft.postProcess).some((value) => value !== undefined) ||
      countPostProcessFiles(draft.postFiles) > 0)
  const discardArchives = confirmed && !draft.acceptsArchives && draft.archives.length > 0
  const discardWebhook = confirmed && !draft.acceptsWebhook && draft.webhookConfigured
  const discardStages =
    confirmed &&
    !draft.acceptsConversionStages &&
    (Boolean(draft.conversionStages) || draft.conversionStageFiles.length > 0)
  const discardAuxiliary = confirmed && draft.legacyStandaloneOverlay && draft.auxiliary.length > 0
  const reasons = [
    ...fieldConflicts.map(({ reason }) => reason),
    ...(discardPostProcess
      ? [
          'Legacy PDF post-processing requires Gotenberg 8. Recreate those settings as PDF stages on Gotenberg 9.',
        ]
      : []),
    ...(discardArchives ? ['ZIP archive inputs require Gotenberg 9.'] : []),
    ...(discardWebhook
      ? ['This Gotenberg version and tool cannot deliver results through a webhook.']
      : []),
    ...(discardStages ? ['Conversion PDF stages require Gotenberg 9.'] : []),
    ...(discardAuxiliary
      ? ['The Gotenberg 9 overlay uploads cannot be used by the Gotenberg 8 overlay editor.']
      : []),
  ]
  return {
    fieldConflicts,
    discardPostProcess,
    discardArchives,
    discardWebhook,
    discardStages,
    discardAuxiliary,
    reasons,
  }
}

/** Check editable outbound settings without clearing them or requiring a completed document. */
export function draftOutboundIssues(
  operation: Operation,
  fields: Record<string, string | boolean>,
  backendVersion: string | undefined,
  draft: {
    remoteRows: readonly RemoteInputRow[]
    remoteInput: string
    webhookSettings: WebhookEditorState
    webhookInput: string
    advanced: string
  },
): string[] {
  const version = parseGotenbergVersion(backendVersion)
  if (!version || (version.major !== 8 && version.major !== 9)) return []
  const issues: string[] = []
  let advanced: ReturnType<typeof parseAdvanced> = {}
  let downloadFrom: ReturnType<typeof validateAsyncInputValues>['downloadFrom']
  let webhook: ReturnType<typeof validateAsyncInputValues>['webhook']
  try {
    advanced = parseAdvanced(draft.advanced)
    validateAdvancedParameters(operation, fields, advanced)
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Invalid Advanced JSON.')
  }
  try {
    downloadFrom = validateAsyncInputValues(
      remoteInputsPayload(draft.remoteRows, draft.remoteInput),
      undefined,
    ).downloadFrom
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Invalid remote inputs.')
  }
  try {
    webhook = validateAsyncInputValues(
      undefined,
      webhookPayload(draft.webhookSettings, draft.webhookInput),
    ).webhook
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Invalid webhook settings.')
  }
  return [
    ...issues,
    ...outboundCompatibilityReasons(operation, version, {
      advanced,
      downloadFrom,
      webhook,
      fields: activeOperationFields(operation, fields, backendVersion),
    }),
  ]
}
