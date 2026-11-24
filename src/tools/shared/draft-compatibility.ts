import type { PdfPostProcess, PostProcessFiles } from '#/lib/pdf-post-processing'
import { countPostProcessFiles } from '#/lib/pdf-post-processing'
import { incompatibleOperationFields } from '#/tools/shared/field-visibility'
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
  const fieldConflicts = incompatibleOperationFields(
    operation,
    fields,
    backendVersion,
    draft.legacyStandaloneOverlay,
  )
  const discardPostProcess =
    !draft.acceptsPostProcess &&
    (Object.values(draft.postProcess).some((value) => value !== undefined) ||
      countPostProcessFiles(draft.postFiles) > 0)
  const discardArchives = !draft.acceptsArchives && draft.archives.length > 0
  const discardWebhook = !draft.acceptsWebhook && draft.webhookConfigured
  const discardStages =
    !draft.acceptsConversionStages &&
    (Boolean(draft.conversionStages) || draft.conversionStageFiles.length > 0)
  const discardAuxiliary = draft.legacyStandaloneOverlay && draft.auxiliary.length > 0
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
