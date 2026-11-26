import { isHttpHeaderValue } from '#/lib/http-url'

/** Ephemeral browser-side inputs. These are form fields for Chromium, not proxy HTTP headers. */
export type ChromiumCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: '' | 'Strict' | 'Lax' | 'None'
}

export type ChromiumResourceHeader = {
  name: string
  value: string
  scope: string
}

/** Go's strings.TrimSpace uses Unicode White_Space, not JavaScript trim. */
export function trimChromiumWhitespace(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
}

/** Match strings.EqualFold, including Unicode simple folding of long s. */
export function isChromiumScopeKey(value: string): boolean {
  return /^scope$/iu.test(trimChromiumWhitespace(value))
}

/** Gotenberg splits headers on semicolons, then removes whitespace from the
 * scope token before compiling its regex. Either character can silently
 * change the URL pattern and widen where a credential is sent.
 */
export function hasAmbiguousChromiumScope(scope: string): boolean {
  return /[;\p{White_Space}]/u.test(scope)
}

/** Gotenberg applies headers with no scope to every requested asset, including
 * third-party URLs. Session identifiers, CSRF proofs and request signatures
 * need the same protection as bearer tokens and API keys.
 */
export function isChromiumCredentialHeader(name: string): boolean {
  return /authorization|token|secret|key|credential|auth|session|csrf|xsrf|signature/i.test(name)
}

const blockedResourceHeaders = new Set([
  'host',
  'cookie',
  'set-cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
])

/** Keep the visual editor and direct proxy requests on the same policy. */
export function isAllowedChromiumResourceHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
    !blockedResourceHeaders.has(lower) &&
    !lower.startsWith('proxy-')
  )
}

/** Canonicalise decoded SameSite values before the Go raw-JSON regex runs. */
export function encodeChromiumCookies(raw: string): string {
  const cookies = JSON.parse(raw) as { sameSite?: string }[]
  return JSON.stringify(
    cookies.map((cookie) => {
      if (cookie.sameSite === undefined) return cookie
      return {
        ...cookie,
        sameSite: cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1).toLowerCase(),
      }
    }),
  )
}

export function chromiumNetworkFields(
  cookies: readonly ChromiumCookie[],
  headers: readonly ChromiumResourceHeader[],
): Record<string, string> {
  const fields: Record<string, string> = {}
  if (cookies.length) {
    fields.cookies = JSON.stringify(
      cookies.map(({ name, value, domain, path, secure, httpOnly, sameSite }) => ({
        name: name.trim(),
        value,
        domain: domain.trim(),
        ...(path ? { path } : {}),
        ...(secure ? { secure } : {}),
        ...(httpOnly ? { httpOnly } : {}),
        ...(sameSite ? { sameSite } : {}),
      })),
    )
  }
  if (headers.length) {
    if (headers.length > 64)
      throw new Error('Chromium resource headers must contain at most 64 entries.')
    const values: Record<string, string> = Object.create(null)
    const used = new Set<string>()
    for (const header of headers) {
      const name = header.name.trim()
      if (!isAllowedChromiumResourceHeader(name)) {
        throw new Error('Invalid or unsafe Chromium resource header name.')
      }
      if (used.has(name.toLowerCase())) throw new Error(`Duplicate Chromium header: ${name}`)
      used.add(name.toLowerCase())
      if (!isHttpHeaderValue(header.value))
        throw new Error('Invalid Chromium resource header value.')
      // Gotenberg treats every case-insensitive `scope` token as special,
      // including a bare token or one at the start of the header value.
      // Keeping it out of the value avoids duplicate or malformed scopes.
      if (header.value.split(';').some((token) => isChromiumScopeKey(token.split('=', 1)[0]))) {
        throw new Error('Set the URL scope in its own field, not in the header value.')
      }
      const scope = trimChromiumWhitespace(header.scope)
      if (!isHttpHeaderValue(scope)) throw new Error('Invalid Chromium header URL scope.')
      if (hasAmbiguousChromiumScope(scope)) {
        throw new Error(
          'Chromium header URL scopes cannot contain semicolons or whitespace; use regex escapes.',
        )
      }
      if (!scope && isChromiumCredentialHeader(name)) {
        throw new Error('Authentication headers require an explicit URL scope.')
      }
      // Gotenberg rejects `scope=` with no pattern; ordinary non-sensitive
      // headers can instead be sent without any scope token.
      values[name] = scope ? `${header.value};scope=${scope}` : header.value
    }
    fields.extraHttpHeaders = JSON.stringify(values)
  }
  return fields
}
