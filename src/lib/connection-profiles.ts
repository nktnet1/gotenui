import * as v from 'valibot'
import { BACKEND_STORAGE_KEY, normalizeBackendUrl } from '#/lib/backend-url'
import { localUuid } from '#/lib/local-id'
import { responseMediaType } from '#/lib/security'
import { isBasicPassword, isBasicUsername, isBearerToken } from '#/lib/upstream-credentials'

export const CONNECTIONS_STORAGE_KEY = 'gotenui.connections.v1'
export const DEFAULT_CONNECTION_ID = 'browser-demo'
const profileSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^browser-[a-zA-Z0-9-]{1,80}$/)),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
  url: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  auth: v.picklist(['none', 'basic', 'bearer']),
})
const featuresSchema = v.object({ showDebug: v.boolean(), showMetrics: v.boolean() })
const savedSchema = v.object({
  selected: v.string(),
  browsers: v.pipe(v.array(profileSchema), v.maxLength(20)),
})
const managedSchema = v.object({
  features: featuresSchema,
  connections: v.pipe(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/)),
        name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
      }),
    ),
    v.maxLength(31),
  ),
})

export type BrowserConnection = v.InferOutput<typeof profileSchema>
export type ManagedConnection = v.InferOutput<typeof managedSchema>['connections'][number]
export type SavedConnections = { selected: string; browsers: BrowserConnection[] }
export type UiFeatures = { showDebug: boolean; showMetrics: boolean }
export type ConnectionSettings = { connections: ManagedConnection[]; features: UiFeatures }
export type ConnectionChoice =
  | { kind: 'browser'; url: string; authorization?: string; credentialsRequired?: boolean }
  | { kind: 'server'; id: string }

export function newBrowserConnection(
  name: string,
  url: string,
  auth: BrowserConnection['auth'] = 'none',
  id = `browser-${localUuid()}`,
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
      const selected = parsed.output.selected
      return {
        selected:
          /^server:[a-z][a-z0-9-]{0,63}$/.test(selected) ||
          browsers.some((item) => item.id === selected)
            ? selected
            : (browsers[0]?.id ?? DEFAULT_CONNECTION_ID),
        browsers,
      }
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

/** Removing an inactive profile must not change the selected connection. */
export function removeBrowserConnection(saved: SavedConnections, id: string): SavedConnections {
  if (id === DEFAULT_CONNECTION_ID || saved.browsers.length <= 1) return saved
  const browsers = saved.browsers.filter((profile) => profile.id !== id)
  if (browsers.length === saved.browsers.length) return saved
  return {
    browsers,
    selected:
      saved.selected === id
        ? (browsers.find((profile) => profile.id === DEFAULT_CONNECTION_ID)?.id ??
          browsers[0]?.id ??
          DEFAULT_CONNECTION_ID)
        : saved.selected,
  }
}

/** A missing managed profile must never silently retarget requests to a browser profile. */
export function selectedConnectionProfile(
  saved: SavedConnections,
  managed: ManagedConnection[],
):
  | { kind: 'server'; key: string; name: string; id: string }
  | { kind: 'browser'; key: string; name: string; profile: BrowserConnection } {
  if (saved.selected.startsWith('server:')) {
    const id = saved.selected.slice(7)
    return {
      kind: 'server',
      key: saved.selected,
      name: managed.find((profile) => profile.id === id)?.name ?? 'Unavailable server connection',
      id,
    }
  }
  const profile = saved.browsers.find((item) => item.id === saved.selected) ?? saved.browsers[0]
  if (!profile) throw new Error('No browser connection is configured.')
  return { kind: 'browser', key: profile.id, name: profile.name, profile }
}

export async function fetchConnectionSettings(signal?: AbortSignal): Promise<ConnectionSettings> {
  const response = await fetch('/api/gotenberg/connections', {
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Could not load managed connections (HTTP ${response.status}).`)
  if (
    response.status !== 200 ||
    responseMediaType(response.headers.get('content-type')) !== 'application/json'
  ) {
    await response.body?.cancel().catch(() => {})
    throw new Error('The API did not return valid connection settings.')
  }
  return v.parse(managedSchema, await response.json())
}

/** Secrets only exist in React memory and are never included in saved JSON. */
export function makeBrowserAuthorization(
  mode: BrowserConnection['auth'],
  username: string,
  secret: string,
): string | undefined {
  if (mode === 'none') return undefined
  if (mode === 'bearer') {
    if (!isBearerToken(secret)) throw new Error('Invalid bearer token (up to 4,096 characters).')
    return `Bearer ${secret}`
  }
  if (!isBasicPassword(secret)) {
    throw new Error('Enter a valid password (up to 2,048 characters, without control characters).')
  }
  if (!isBasicUsername(username)) {
    throw new Error(
      'Basic Auth needs a username without a colon or control characters (up to 255 characters).',
    )
  }
  const bytes = new TextEncoder().encode(`${username}:${secret}`)
  return `Basic ${btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(''))}`
}

/** Restored profiles retain their authentication mode, not their secret. */
export function browserConnectionChoice(
  profile: BrowserConnection,
  username: string,
  secret: string,
): ConnectionChoice {
  if (profile.auth !== 'none' && (!secret || (profile.auth === 'basic' && !username))) {
    return { kind: 'browser', url: profile.url, credentialsRequired: true }
  }
  return {
    kind: 'browser',
    url: profile.url,
    authorization: makeBrowserAuthorization(profile.auth, username, secret),
  }
}

export function requireConnectionCredentials(connection: string | ConnectionChoice): void {
  if (
    typeof connection !== 'string' &&
    connection.kind === 'browser' &&
    connection.credentialsRequired
  ) {
    throw new Error(
      'Re-enter the saved connection credentials in connection settings before making requests.',
    )
  }
}
