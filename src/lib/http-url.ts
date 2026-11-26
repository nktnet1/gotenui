/** Check the original HTTP URL as well as its WHATWG interpretation.
 * The Go backend receives the original spelling, not a browser-normalised URL.
 */
export function isHttpUrl(value: string): boolean {
  const raw = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#([\s\S]*))?$/i.exec(value)
  if (
    !raw ||
    /\p{Cs}/u.test(value) ||
    raw[1]?.includes('\\') ||
    raw[1]?.includes(' ') ||
    raw[1]?.includes('@') ||
    // Go rejects percent-encoded ASCII in hostnames, unlike WHATWG URL.
    /%[0-7][0-9a-f]/i.test(raw[1] ?? '') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    }) ||
    // Go validates percent escapes in the path and fragment, not RawQuery.
    /%(?![0-9a-f]{2})/i.test(raw[2] ?? '') ||
    /%(?![0-9a-f]{2})/i.test(raw[3] ?? '')
  ) {
    return false
  }
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !!url.hostname &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

/** A preview must never reproduce callback secrets, pre-signed URL paths/queries, or header values. */
export function safeOutboundHost(url: string): string {
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return '(invalid URL)'
    return parsed.origin
  } catch {
    return '(invalid URL)'
  }
}

/** HTTP field values must survive UTF-8 encoding without replacement. */
export function isHttpHeaderValue(value: string): boolean {
  return (
    !/\p{Cs}/u.test(value) &&
    ![...value].some((char) => {
      const code = char.charCodeAt(0)
      return (code < 32 && code !== 9) || code === 127
    })
  )
}

/** Parse a configured fetch destination without letting WHATWG URL repair a
 * missing authority, strip credentials or change malformed input characters.
 * Unlike outbound Go URLs, these endpoints are intentionally canonicalised.
 */
export function parseHttpEndpoint(value: string): URL | undefined {
  const authority = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1]
  if (
    !authority ||
    authority.includes('@') ||
    authority.includes(' ') ||
    /[\\?#]/u.test(value) ||
    !isHttpHeaderValue(value) ||
    value.includes('\t')
  )
    return undefined
  try {
    const parsed = new URL(value)
    return parsed.hostname && !parsed.username && !parsed.password ? parsed : undefined
  } catch {
    return undefined
  }
}
