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
    const values: Record<string, string> = Object.create(null)
    const used = new Set<string>()
    for (const header of headers) {
      const name = header.name.trim()
      if (used.has(name.toLowerCase())) throw new Error(`Duplicate Chromium header: ${name}`)
      used.add(name.toLowerCase())
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
      if (!scope && /authorization|token|secret|key|credential|auth/i.test(name)) {
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
