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
