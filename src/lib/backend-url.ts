import { parseHttpEndpoint } from '#/lib/http-url'

/** Normalize a Gotenberg base URL without accepting credentials or opaque schemes. */
export function normalizeBackendUrl(input: string): string {
  const value = input.trim()
  if (!value || value.length > 2048) {
    throw new Error('Enter a Gotenberg URL (up to 2,048 characters).')
  }
  if (!/^https?:\/\//i.test(value) || value.includes('\\')) {
    throw new Error('Use an absolute HTTP or HTTPS Gotenberg URL.')
  }
  const parsed = parseHttpEndpoint(value)
  if (!parsed) {
    throw new Error('Enter a valid absolute Gotenberg URL without credentials, query or fragment.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

/** The public demo is a host, not just a single base path. Never attach
 * credentials to alternate ports, paths or DNS-equivalent trailing dots.
 */
export const DEMO_GOTENBERG_URL = 'https://demo.gotenberg.dev'

export function isPublicDemoBackend(value: string): boolean {
  try {
    return new URL(value).hostname.replace(/\.+$/, '') === new URL(DEMO_GOTENBERG_URL).hostname
  } catch {
    return false
  }
}

export const BACKEND_STORAGE_KEY = 'gotenui.backend-url.v1'

/** Some browser privacy modes throw when merely accessing window.localStorage. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadBackendUrl(storage: Pick<Storage, 'getItem'> | null): string {
  try {
    const value = storage?.getItem(BACKEND_STORAGE_KEY)
    return value ? normalizeBackendUrl(value) : ''
  } catch {
    // Storage may be disabled or the saved value may be invalid.
    return ''
  }
}

export function saveBackendUrl(storage: Pick<Storage, 'setItem'> | null, url: string): boolean {
  try {
    if (!storage) return false
    storage.setItem(BACKEND_STORAGE_KEY, normalizeBackendUrl(url))
    return true
  } catch {
    return false
  }
}
