import type { ServerStatus } from '#/lib/gotenberg-client'

/** Status is only actionable for the exact selected connection and credential epoch.
 * An old /version response must never enable tools on a newly selected backend.
 */
export type ObservedConnectionStatus = {
  key: string
  value: ServerStatus
}

export function statusForConnection(
  observed: ObservedConnectionStatus | null,
  selectedKey: string,
): ServerStatus | null {
  return observed?.key === selectedKey ? observed.value : null
}
