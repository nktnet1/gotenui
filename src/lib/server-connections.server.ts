import { createHash, timingSafeEqual } from 'node:crypto'
import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'
import { DEMO_GOTENBERG_URL, ProxyInputError } from '#/lib/proxy-policy'
import { parseUpstreamBasicAuth } from '#/lib/upstream-auth.server'

const idSchema = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/))
const nameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))
const basicSchema = v.object({
  type: v.literal('basic'),
  username: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
})
const bearerSchema = v.object({
  type: v.literal('bearer'),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
})
const connectionSchema = v.object({
  id: idSchema,
  name: nameSchema,
  url: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  auth: v.optional(v.variant('type', [basicSchema, bearerSchema])),
})
const connectionListSchema = v.pipe(v.array(connectionSchema), v.maxLength(30))

export type ServerConnection = Readonly<{
  id: string
  name: string
  url: string
  authorization?: string
  requiresKey: boolean
}>
export type PublicServerConnection = Readonly<{
  id: string
  name: string
  requiresKey: boolean
}>

function secureEquals(actual: string, expected: string): boolean {
  const a = createHash('sha256').update(actual).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Validate and bind all secrets at request time. Nothing is persisted or sent to the browser. */
export function parseServerConnections(
  env: NodeJS.ProcessEnv,
  allowed: ReadonlySet<string>,
): { connections: ServerConnection[]; accessKey: string | undefined } {
  const accessKey = env.GOTENUI_PROFILE_ACCESS_KEY
  if (accessKey !== undefined && (accessKey.length < 16 || accessKey.length > 4096)) {
    throw new Error('GOTENUI_PROFILE_ACCESS_KEY must contain 16 to 4096 characters.')
  }
  let entries: v.InferOutput<typeof connectionListSchema> = []
  if (env.GOTENUI_SERVER_CONNECTIONS) {
    let parsed: unknown
    try {
      parsed = JSON.parse(env.GOTENUI_SERVER_CONNECTIONS)
    } catch {
      throw new Error('GOTENUI_SERVER_CONNECTIONS must be valid JSON.')
    }
    const result = v.safeParse(connectionListSchema, parsed)
    if (!result.success) throw new Error('GOTENUI_SERVER_CONNECTIONS has invalid profiles.')
    entries = result.output
  }
  const connections: ServerConnection[] = entries.map((entry) => {
    if (entry.auth?.type === 'basic' && entry.auth.username.includes(':')) {
      throw new Error(`Basic Auth username for ${entry.id} must not contain a colon.`)
    }
    if (entry.auth?.type === 'bearer' && !/^[A-Za-z0-9._~+/-]+=*$/.test(entry.auth.token)) {
      throw new Error(`Bearer token for ${entry.id} contains invalid characters.`)
    }
    const url = normalizeBackendUrl(entry.url)
    if (!allowed.has(url)) {
      throw new Error(`Server connection ${entry.id} must exactly match GOTENBERG_ALLOWED_URLS.`)
    }
    if (entry.auth && url === DEMO_GOTENBERG_URL) {
      throw new Error('Do not configure upstream credentials for the public Gotenberg demo.')
    }
    const authorization =
      entry.auth?.type === 'basic'
        ? `Basic ${Buffer.from(`${entry.auth.username}:${entry.auth.password}`, 'utf8').toString('base64')}`
        : entry.auth?.type === 'bearer'
          ? `Bearer ${entry.auth.token}`
          : undefined
    return { id: entry.id, name: entry.name, url, authorization, requiresKey: !!accessKey }
  })
  // Backwards compatibility: v1.0.9 credentials become an explicitly selected,
  // protected profile rather than silently authorizing requests based on URL alone.
  const legacy = parseUpstreamBasicAuth(env, allowed)
  if (legacy) {
    connections.push({
      id: 'legacy-basic',
      name: 'Private Gotenberg (legacy)',
      url: legacy.target,
      authorization: legacy.authorization,
      requiresKey: true,
    })
  }
  if (new Set(connections.map((connection) => connection.id)).size !== connections.length) {
    throw new Error('Server connection IDs must be unique.')
  }
  if (connections.some((connection) => connection.authorization) && !accessKey) {
    throw new Error('GOTENUI_PROFILE_ACCESS_KEY is required for authenticated server connections.')
  }
  return { connections, accessKey }
}

export function publicServerConnections(connections: ServerConnection[]): PublicServerConnection[] {
  return connections.map(({ id, name, requiresKey }) => ({ id, name, requiresKey }))
}

export function requireServerConnection(
  id: string,
  key: string | null,
  connections: ServerConnection[],
  accessKey: string | undefined,
): ServerConnection {
  const selected = connections.find((connection) => connection.id === id)
  if (!selected) throw new ProxyInputError('Unknown server-managed connection.', 404)
  if (selected.requiresKey && (!accessKey || !key || !secureEquals(key, accessKey))) {
    throw new ProxyInputError('This server-managed connection requires a valid access key.', 403)
  }
  return selected
}
