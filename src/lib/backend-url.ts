/** Normalize a Gotenberg base URL without accepting credentials or opaque schemes. */
export function normalizeBackendUrl(input: string): string {
  const value = input.trim()
  if (!value || value.length > 2048) {
    throw new Error('Enter a Gotenberg URL (up to 2,048 characters).')
  }
  if (!/^https?:\/\//i.test(value) || value.includes('\\')) {
    throw new Error('Use an absolute HTTP or HTTPS Gotenberg URL.')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Enter a valid absolute Gotenberg URL.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('The Gotenberg URL must use HTTP or HTTPS.')
  }
  if (parsed.username || parsed.password || value.includes('?') || value.includes('#')) {
    throw new Error('Do not include credentials, query strings or fragments in the URL.')
  }
  return parsed.toString().replace(/\/+$/, '')
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
