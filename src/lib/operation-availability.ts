import type { ServerStatus } from '#/lib/gotenberg-client'
import {
  type GotenbergVersion,
  parseGotenbergVersion,
  requiresGotenberg91ForExtraction,
  requiresGotenberg92ForComposition,
} from '#/lib/gotenberg-version'
import type { Operation } from '#/tools/registry'

/** Legacy feature gates are specific to Gotenberg 8's minor-version numbering. */
export function versionAtLeast(version: string | undefined, minor: number): boolean | null {
  const parsed = parseGotenbergVersion(version)
  return parsed?.major === 8 ? parsed.minor >= minor : null
}

/** Gotenberg 9 cannot use a webhook when the route answers with JSON directly. */
export function canWebhookForOperation(major: number, operation: Operation): boolean {
  return major !== 9 || operation.output !== 'json'
}

/** Only a current, successful status probe can authorise a submission or discard. */
export function confirmedBackendVersion(
  status: ServerStatus | null,
  pending: boolean,
): string | undefined {
  if (pending || !status?.online) return undefined
  const version = parseGotenbergVersion(status.version)
  return version && (version.major === 8 || version.major === 9) ? status.version : undefined
}

/** Route availability is shared by the workbench and the authenticated conversion proxy. */
export function operationMinimumVersionReason(
  version: GotenbergVersion,
  operation: Operation,
): string | null {
  if (requiresGotenberg91ForExtraction(version, [operation.id])) {
    return 'PDF text and attachment extraction require Gotenberg 9.1 or newer.'
  }
  if (requiresGotenberg92ForComposition(version, [operation.id])) {
    return 'PDF page composition requires Gotenberg 9.2 or newer.'
  }
  if (operation.id === 'optimize' && version.major === 8 && version.minor < 36) {
    return 'Optimize PDFs requires Gotenberg 8.36 or newer.'
  }
  return null
}

/** The selected instance decides availability; unknown/unsupported majors must not be treated as v8. */
export function unavailableOperationReason(
  status: ServerStatus | null,
  operation: Operation,
): string | null {
  if (!status?.online) return null // Connection troubleshooting remains available.
  const version = parseGotenbergVersion(status.version)
  if (!version) {
    return 'Gotenberg did not report a recognisable version. Check its /version endpoint before running tools.'
  }
  if (version.major !== 8 && version.major !== 9) {
    return `Gotenberg ${version.major} is not supported. Select a Gotenberg 8 or 9 connection.`
  }
  if (!(operation.supportedGotenbergMajors ?? [8]).includes(version.major)) {
    return version.major === 8
      ? 'This tool requires Gotenberg 9. Select a Gotenberg 9 connection for this workflow.'
      : 'This tool has not been migrated to Gotenberg 9 yet. Select a Gotenberg 8 connection for this workflow.'
  }
  const versionReason = operationMinimumVersionReason(version, operation)
  if (versionReason) return versionReason
  const healthModules = status.modules.filter((module) =>
    ['chromium', 'libreoffice'].includes(module.name.toLowerCase()),
  )
  const required = operation.path.startsWith('/forms/chromium/')
    ? 'chromium'
    : operation.input === 'office' ||
        (version.major === 8 && ['pdfa', 'factur-x'].includes(operation.id))
      ? 'libreoffice'
      : null
  if (
    required &&
    healthModules.length > 0 &&
    !healthModules.some(
      (module) => module.name.toLowerCase() === required && module.status === 'up',
    )
  ) {
    return `The selected Gotenberg instance does not have a healthy ${required === 'chromium' ? 'Chromium' : 'LibreOffice'} module.`
  }
  return null
}

export function backendCompatibilityNotice(status: ServerStatus | null): string | null {
  if (!status?.online) return null
  const version = parseGotenbergVersion(status.version)
  if (!version) {
    return 'Gotenui could not verify this Gotenberg version. Tools are paused until /version reports a supported version.'
  }
  // A supported version needs no global banner. Only the selected tool should
  // explain an unsupported setting or request explicit safety confirmation.
  if (version.major !== 8 && version.major !== 9) {
    return `Gotenberg ${version.major} is not supported. Select Gotenberg 8 or 9 to use the tools.`
  }
  return null
}
