import { InputError } from '#/lib/validation'

/** Browser and proxy use the same URL grammar for RFC 3161 authorities.
 * Gotenberg remains responsible for DNS resolution, redirects and outbound IP
 * restrictions (--pdf-allow-list / --pdf-deny-private-ips).
 */
export function timestampAuthorityUrl(value: string): string {
  if (
    !value ||
    value.length > 2_000 ||
    value !== value.trim() ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\',
    )
  ) {
    throw new InputError(
      'Enter a valid HTTP(S) timestamp authority URL without whitespace or backslashes.',
    )
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InputError('Enter a valid HTTP(S) timestamp authority URL.')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new InputError(
      'Timestamp authority URLs must be HTTP(S) without credentials or fragments.',
    )
  }
  // Canonicalize before forwarding so a URL accepted by the browser cannot be
  // reinterpreted differently by an upstream parser.
  return url.href
}
