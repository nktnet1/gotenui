import type { ServerStatus } from '#/lib/gotenberg-client'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import type { Operation } from '#/tools/registry'

/** Legacy feature gates are specific to Gotenberg 8's minor-version numbering. */
export function versionAtLeast(version: string | undefined, minor: number): boolean | null {
  const parsed = parseGotenbergVersion(version)
  return parsed?.major === 8 ? parsed.minor >= minor : null
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
    return `This tool has not been migrated to Gotenberg ${version.major} yet. Select a Gotenberg 8 connection for this workflow.`
  }
  const healthModules = status.modules.filter((module) =>
    ['chromium', 'libreoffice'].includes(module.name.toLowerCase()),
  )
  const required = operation.path.startsWith('/forms/chromium/')
    ? 'chromium'
    : operation.input === 'office' || ['pdfa', 'factur-x'].includes(operation.id)
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
  if (operation.id === 'optimize' && versionAtLeast(status.version, 36) === false) {
    return 'Optimize PDFs requires Gotenberg 8.36 or newer.'
  }
  return null
}

export function backendCompatibilityNotice(status: ServerStatus | null): string | null {
  if (!status?.online) return null
  const version = parseGotenbergVersion(status.version)
  if (!version) {
    return 'Gotenui could not verify this Gotenberg version. Tools are paused until /version reports a supported version.'
  }
  if (version.major === 9) {
    return 'Gotenberg 9 detected. Screenshot tools are available; PDF conversions and processing remain paused until their v9 adapters are ready. Switch to a Gotenberg 8 connection for those workflows.'
  }
  if (version.major !== 8) {
    return `Gotenberg ${version.major} is not supported. Select Gotenberg 8 or 9 to use the tools.`
  }
  return null
}
