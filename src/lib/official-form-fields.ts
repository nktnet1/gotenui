/** Human-friendly Chromium reliability controls. Gotenberg expects JSON arrays. */
export const CONSOLE_MESSAGE_TYPES = ['log', 'debug', 'info', 'warning', 'error', 'assert'] as const
export type ConsoleMessageType = (typeof CONSOLE_MESSAGE_TYPES)[number]

/** Chromium uses "warning" for console.warn(), not "warn". */
export function parseConsoleMessageTypes(raw: string): ConsoleMessageType[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Console message types must be a JSON array.')
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > CONSOLE_MESSAGE_TYPES.length ||
    parsed.some((item) => !CONSOLE_MESSAGE_TYPES.includes(item)) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error(`Choose unique console message types: ${CONSOLE_MESSAGE_TYPES.join(', ')}.`)
  }
  return parsed as ConsoleMessageType[]
}

/** Empty selection omits the field and preserves the upstream default. */
export function updateConsoleMessageTypes(
  raw: string,
  messageType: ConsoleMessageType,
  checked: boolean,
): string {
  const current = raw ? parseConsoleMessageTypes(raw) : []
  const next = checked
    ? [...new Set([...current, messageType])]
    : current.filter((value) => value !== messageType)
  return next.length ? JSON.stringify(next) : ''
}

export function parseStatusCodes(input: string): number[] {
  const parts = input.split(',').map((value) => value.trim())
  if (parts.some((value) => !/^[1-5]\d\d$/.test(value))) {
    throw new Error('Enter HTTP status codes (100–599) separated by commas.')
  }
  return [...new Set(parts.map(Number))]
}

export function parseIgnoredDomains(input: string): string[] {
  const parts = input.split(',').map((value) => value.trim())
  for (const value of parts) {
    // Gotenberg 9 normalises full URLs, ports, paths and wildcard prefixes to
    // hostnames. Retain the original spelling for Gotenberg to normalise.
    if (
      !value ||
      [...value].some((char) => {
        const code = char.codePointAt(0) ?? 0
        return code < 32 || code === 127
      })
    ) {
      throw new Error('Enter comma-separated asset exclusion domains or URLs.')
    }
    const candidate = value.replace(/^\*\./u, '').replace(/^\./u, '')
    const url = candidate.startsWith('//')
      ? `https:${candidate}`
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`
    try {
      const parsed = new URL(url)
      if (!parsed.hostname || parsed.username || parsed.password) {
        throw new Error('Invalid asset exclusion hostname.')
      }
    } catch {
      throw new Error('Enter comma-separated asset exclusion domains or URLs.')
    }
  }
  return [...new Set(parts.map((value) => value.toLowerCase()))]
}

export function encodeOfficialField(
  field: { name: string; kind: string } | undefined,
  value: string | boolean,
): string {
  if (field?.kind === 'http-codes') return JSON.stringify(parseStatusCodes(String(value)))
  if (field?.kind === 'hostnames') return JSON.stringify(parseIgnoredDomains(String(value)))
  if (field?.name === 'nativeWatermarkColor') {
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) throw new Error('Invalid native watermark colour.')
    return String(Number.parseInt(String(value).slice(1), 16))
  }
  if (field?.name === 'nativeWatermarkRotateAngle') {
    const degrees = Number(value)
    if (!Number.isFinite(degrees) || Math.abs(degrees * 10 - Math.round(degrees * 10)) > 1e-7) {
      throw new Error('Native watermark rotation supports one decimal place.')
    }
    return String(Math.round(degrees * 10))
  }
  return String(value)
}
