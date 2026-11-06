import type { RemediationReport } from '#/lib/gotenberg-client'
import type { PdfValidationResult } from '#/lib/pdf-validation-report'

/** Shared job, webhook, and output shapes used by the form and result panel. */
export type Job = {
  id: number
  operation: string
  name: string
  size: number
  elapsed: number
  trace?: string
}

export type AcceptedWebhook = {
  status: 202 | 204
  trace?: string
  receiverHost: string
  eventsReceiverHost?: string
}

export type Download = {
  url: string
  name: string
  size: number
  type: string
  /** Browser-local reference for inspecting a ZIP index; never uploaded or persisted. */
  blob?: Blob
  preview?: string
  trace?: string
  remediation?: RemediationReport
  validation?: PdfValidationResult[]
}
