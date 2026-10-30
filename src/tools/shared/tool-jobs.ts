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
}

export type Download = {
  url: string
  name: string
  size: number
  type: string
  preview?: string
  trace?: string
}
