import * as v from 'valibot'
import { BACKEND_STORAGE_KEY, normalizeBackendUrl } from '#/lib/backend-url'

export const CONNECTIONS_STORAGE_KEY = 'gotenui.connections.v1'
export const DEFAULT_CONNECTION_ID = 'browser-demo'
const profileSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^browser-[a-zA-Z0-9-]{1,80}$/)),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
  url: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  auth: v.picklist(['none', 'basic', 'bearer']),
})
const savedSchema = v.object({
  selected: v.string(),
  browsers: v.pipe(v.array(profileSchema), v.maxLength(20)),
})
const managedSchema = v.object({
  connections: v.pipe(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/)),
        name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
        requiresKey: v.boolean(),
      }),
    ),
    v.maxLength(31),
  ),
})

export type BrowserConnection = v.InferOutput<typeof profileSchema>
export type ManagedConnection = v.InferOutput<typeof managedSchema>['connections'][number]
export type SavedConnections = { selected: string; browsers: BrowserConnection[] }
export type ConnectionChoice =
  | { kind: 'browser'; url: string; authorization?: string }
  | { kind: 'server'; id: string; accessKey?: string }

export function newBrowserConnection(
  name: string,
  url: string,
  auth: BrowserConnection['auth'] = 'none',
  id = `browser-${crypto.randomUUID()}`,
): BrowserConnection {
  const parsed = v.parse(profileSchema, { id, name, url: normalizeBackendUrl(url), auth })
  return parsed
}

export function defaultBrowserConnections(url: string): SavedConnections {
  return {
    selected: DEFAULT_CONNECTION_ID,
    browsers: [
      newBrowserConnection(
        url === 'https://demo.gotenberg.dev' ? 'Gotenberg demo' : 'Default Gotenberg',
        url,
        'none',
        DEFAULT_CONNECTION_ID,
      ),
    ],
  }
}

/** Import only public connection metadata; deliberately discard any unknown fields. */
export function loadConnections(
  storage: Pick<Storage, 'getItem'> | null,
  defaultUrl: string,
): SavedConnections {
  const fallback = defaultBrowserConnections(defaultUrl)
  try {
    const raw = storage?.getItem(CONNECTIONS_STORAGE_KEY)
    if (raw) {
      const parsed = v.safeParse(savedSchema, JSON.parse(raw))
      if (!parsed.success) return fallback
      const seen = new Set<string>()
      const browsers = parsed.output.browsers.map((item) => {
        if (seen.has(item.id)) throw new Error('Duplicate connection ID')
        seen.add(item.id)
        return { ...item, url: normalizeBackendUrl(item.url) }
      })
      if (browsers.length === 0) return fallback
      return { selected: parsed.output.selected, browsers }
    }
    // Migrate the URL preference from v1.0.9 without copying any credentials.
    const legacy = storage?.getItem(BACKEND_STORAGE_KEY)
    if (legacy) {
      const url = normalizeBackendUrl(legacy)
      if (url !== normalizeBackendUrl(defaultUrl)) {
        return {
          selected: 'browser-legacy',
          browsers: [
            ...fallback.browsers,
            newBrowserConnection('Previous connection', url, 'none', 'browser-legacy'),
          ],
        }
      }
    }
  } catch {
    // Invalid/unavailable storage should not break the application shell.
  }
  return fallback
}

export function saveConnections(
  storage: Pick<Storage, 'setItem'> | null,
  value: SavedConnections,
): boolean {
  try {
    if (!storage) return false
    const parsed = v.parse(savedSchema, value)
    if (
      !parsed.browsers.length ||
      new Set(parsed.browsers.map((p) => p.id)).size !== parsed.browsers.length
    ) {
      return false
    }
    storage.setItem(
      CONNECTIONS_STORAGE_KEY,
      JSON.stringify({
        selected: parsed.selected,
        browsers: parsed.browsers.map((item) => ({ ...item, url: normalizeBackendUrl(item.url) })),
      }),
    )
    return true
  } catch {
    return false
  }
}

export async function fetchManagedConnections(signal?: AbortSignal): Promise<ManagedConnection[]> {
  const response = await fetch('/api/gotenberg/connections', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Could not load managed connections (HTTP ${response.status}).`)
  return v.parse(managedSchema, await response.json()).connections
}

/** Secrets only exist in React memory and are never included in saved JSON. */
export function makeBrowserAuthorization(
  mode: BrowserConnection['auth'],
  username: string,
  secret: string,
): string | undefined {
  if (mode === 'none') return undefined
  if (!secret || secret.length > 2048 || /[\r\n]/.test(secret)) {
    throw new Error('Enter a valid password or token (up to 2,048 characters).')
  }
  if (mode === 'bearer') {
    if (!/^[A-Za-z0-9._~+/-]+=*$/.test(secret)) throw new Error('Invalid bearer token.')
    return `Bearer ${secret}`
  }
  if (!username || username.length > 255 || username.includes(':')) {
    throw new Error('Basic Auth needs a username without a colon.')
  }
  const bytes = new TextEncoder().encode(`${username}:${secret}`)
  return `Basic ${btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(''))}`
}
