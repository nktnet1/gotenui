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
    const values: Record<string, string> = {}
    const used = new Set<string>()
    for (const header of headers) {
      const name = header.name.trim()
      if (used.has(name.toLowerCase())) throw new Error(`Duplicate Chromium header: ${name}`)
      used.add(name.toLowerCase())
      if (header.value.includes(';scope='))
        throw new Error('Do not include ;scope= in the header value. Use the URL scope field.')
      values[name] = `${header.value};scope=${header.scope.trim()}`
    }
    fields.extraHttpHeaders = JSON.stringify(values)
  }
  return fields
}
