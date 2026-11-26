import { isHttpUrl } from '#/lib/http-url'
import { InputError } from '#/lib/validation'

/** Browser and proxy use the same URL grammar for RFC 3161 authorities.
 * Gotenberg remains responsible for DNS resolution, redirects and outbound IP
 * restrictions (--pdf-allow-list / --pdf-deny-private-ips).
 */
export function timestampAuthorityUrl(value: string): string {
  if (!value || value.length > 2_000 || /[\s\p{White_Space}\\]/u.test(value)) {
    throw new InputError(
      'Enter a valid HTTP(S) timestamp authority URL without whitespace or backslashes.',
    )
  }
  if (!isHttpUrl(value) || value.includes('#')) {
    throw new InputError(
      'Timestamp authority URLs must be absolute HTTP(S) without credentials or fragments.',
    )
  }
  // Keep signed paths, escapes, ports and query strings as supplied.
  return value
}
