/** API compatibility is based on the selected server's /version response, not the UI version. */
export type SupportedGotenbergMajor = 8 | 9

export type GotenbergVersion = {
  major: number
  minor: number
  patch: number
}

/** Accept release and prerelease versions; do not guess a major from arbitrary text. */
export function parseGotenbergVersion(version: string | undefined): GotenbergVersion | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version ?? '',
  )
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? 0)
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch }
}

/** PDF extraction endpoints and final pipeline stages were added in Gotenberg 9.1. */
export function requiresGotenberg91ForExtraction(
  version: GotenbergVersion,
  operations: Iterable<string>,
): boolean {
  if (version.major !== 9 || version.minor >= 1) return false
  for (const operation of operations) {
    if (operation === 'extract-text' || operation === 'extract-attachments') return true
  }
  return false
}

/** PDF composition is new in Gotenberg 9.2 (both the route and pipeline stage). */
export function requiresGotenberg92ForComposition(
  version: GotenbergVersion,
  operations: Iterable<string>,
): boolean {
  if (version.major !== 9 || version.minor >= 2) return false
  for (const operation of operations) {
    if (operation === 'compose' || operation === 'compose-pages') return true
  }
  return false
}

/** Only Gotenberg 9.4+ understands anchored text, image and PDF stamps. */
export function requiresGotenberg94ForStampPosition(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; position?: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 4) return false
  for (const { op, position } of stages) {
    if (
      (op === 'stamp-text' || op === 'stamp-image' || op === 'stamp-pdf') &&
      position !== undefined &&
      position !== null &&
      position !== ''
    ) {
      return true
    }
  }
  return false
}
