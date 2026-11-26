/** Check the original HTTP URL as well as its WHATWG interpretation.
 * The Go backend receives the original spelling, not a browser-normalised URL.
 */
export function isHttpUrl(value: string): boolean {
  const raw = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#([\s\S]*))?$/i.exec(value)
  if (
    !raw ||
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
