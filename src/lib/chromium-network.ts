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
        ...(path.trim() ? { path: path.trim() } : {}),
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
      if (/[\r\n]/.test(header.value)) throw new Error('Invalid Chromium resource header value.')
      // Gotenberg treats every case-insensitive `scope` token as special,
      // including a bare token or one at the start of the header value.
      // Keeping it out of the value avoids duplicate or malformed scopes.
      if (
        header.value
          .split(';')
          .some((token) => token.split('=', 1)[0]?.trim().toLowerCase() === 'scope')
      ) {
        throw new Error('Set the URL scope in its own field, not in the header value.')
      }
      const scope = header.scope.trim()
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
