import type { ServerStatus } from '#/lib/gotenberg-client'
import type { Operation } from '#/lib/operations'

/** The status API returns /health and /version; absence of details is not proof a module is missing. */
export function versionAtLeast(version: string | undefined, minor: number): boolean | null {
  const match = /^v?8\.(\d+)(?:\.\d+)?(?:\b|[-+])/.exec(version ?? '')
  return match ? Number(match[1]) >= minor : null
}

export function unavailableOperationReason(
  status: ServerStatus | null,
  operation: Operation,
): string | null {
  if (!status?.online) return null // Connection troubleshooting remains available.
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
