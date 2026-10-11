/** Human-friendly Chromium reliability controls. Gotenberg expects JSON arrays. */
export function parseStatusCodes(input: string): number[] {
  const parts = input.split(',').map((value) => value.trim())
  if (parts.length > 30 || parts.some((value) => !/^[1-5]\d\d$/.test(value))) {
    throw new Error('Enter up to 30 HTTP status codes (100–599) separated by commas.')
  }
  return [...new Set(parts.map(Number))]
}

export function parseIgnoredDomains(input: string): string[] {
  const parts = input.split(',').map((value) => value.trim())
  if (
    parts.length > 30 ||
    parts.some(
      (value) =>
        value.length > 253 ||
        !/^(?:\*\.|\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value),
    )
  ) {
    throw new Error('Enter up to 30 domain names separated by commas, without URLs or paths.')
  }
  return [...new Set(parts.map((value) => value.toLowerCase()))]
}

export function encodeOfficialField(
  field: { name: string; kind: string } | undefined,
  value: string | boolean,
): string {
  if (field?.kind === 'http-codes') return JSON.stringify(parseStatusCodes(String(value)))
  if (field?.kind === 'hostnames') return JSON.stringify(parseIgnoredDomains(String(value)))
  return String(value)
}
