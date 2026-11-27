import * as v from 'valibot'
import { isPublicDemoBackend, normalizeBackendUrl } from '#/lib/backend-url'
import { isHttpHeaderValue, parseHttpEndpoint } from '#/lib/http-url'
import {
  type OAuth2ClientCredentials,
  parseOAuth2TokenUrl,
} from '#/lib/oauth2-client-credentials.server'
import { ProxyInputError } from '#/lib/proxy-policy'
import { parseUpstreamBasicAuth } from '#/lib/upstream-auth.server'
import {
  isBasicPassword,
  isBasicUsername,
  isBearerToken,
  MAX_BASIC_PASSWORD_LENGTH,
  MAX_BASIC_USERNAME_LENGTH,
  MAX_BEARER_TOKEN_LENGTH,
} from '#/lib/upstream-credentials'

const idSchema = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/))
const nameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))
const basicSchema = v.strictObject({
  type: v.literal('basic'),
  username: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_BASIC_USERNAME_LENGTH)),
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_BASIC_PASSWORD_LENGTH)),
})
const bearerSchema = v.strictObject({
  type: v.literal('bearer'),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_BEARER_TOKEN_LENGTH)),
})
const oauth2Schema = v.strictObject({
  type: v.literal('oauth2'),
  tokenUrl: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
  clientSecret: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  scope: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1024))),
  audience: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1024))),
  authMethod: v.optional(v.picklist(['client_secret_basic', 'client_secret_post'])),
})
const connectionSchema = v.strictObject({
  id: idSchema,
  name: nameSchema,
  url: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  auth: v.optional(v.variant('type', [basicSchema, bearerSchema, oauth2Schema])),
  metricsUrl: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2048))),
  metricsAuth: v.optional(v.variant('type', [basicSchema, bearerSchema])),
})
const connectionListSchema = v.pipe(v.array(connectionSchema), v.maxLength(30))

export type ServerConnection = Readonly<{
  id: string
  name: string
  url: string
  authorization?: string
  oauth2?: OAuth2ClientCredentials
  metricsUrl?: string
  metricsAuthorization?: string
}>
export type PublicServerConnection = Readonly<{
  id: string
  name: string
}>

/** A metrics collector is a deployment-only target, never a browser-supplied URL.
 * The dedicated OTEL Prometheus exporter serves /metrics on port 9464 by default.
 */
export function parseMetricsUrl(value: string): string {
  const parsed = parseHttpEndpoint(value.trim())
  if (parsed?.pathname !== '/metrics') {
    throw new Error(
      'metricsUrl must be an absolute HTTP(S) /metrics URL without credentials or query parameters.',
    )
  }
  return parsed.href
}

function authorizationFor(
  auth:
    | { type: 'basic'; username: string; password: string }
    | { type: 'bearer'; token: string }
    | undefined,
  label: string,
): string | undefined {
  if (!auth) return undefined
  if (auth.type === 'basic') {
    if (!isBasicUsername(auth.username) || !isBasicPassword(auth.password))
      throw new Error(`Invalid Basic Auth username or password for ${label}.`)
    return `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`
  }
  if (!isBearerToken(auth.token)) {
    throw new Error(`Bearer token for ${label} contains invalid characters.`)
  }
  return `Bearer ${auth.token}`
}

/** Resolve deployment-defined profiles; the upstream decides access via its credentials. */
export function parseServerConnections(
  env: NodeJS.ProcessEnv,
  allowed: ReadonlySet<string>,
): { connections: ServerConnection[] } {
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
    const url = normalizeBackendUrl(entry.url)
    if (!allowed.has(url)) {
      throw new Error(`Server connection ${entry.id} must exactly match GOTENBERG_ALLOWED_URLS.`)
    }
    if (entry.auth && isPublicDemoBackend(url)) {
      throw new Error('Do not configure upstream credentials for the public Gotenberg demo.')
    }
    if (entry.metricsAuth && !entry.metricsUrl) {
      throw new Error(`Metrics credentials for ${entry.id} require metricsUrl.`)
    }
    if (entry.auth?.type === 'oauth2') {
      for (const value of [
        entry.auth.clientId,
        entry.auth.clientSecret,
        entry.auth.scope,
        entry.auth.audience,
      ]) {
        if (value !== undefined && (!isHttpHeaderValue(value) || value.includes('\t'))) {
          throw new Error(`Invalid OAuth2 credential or parameter for ${entry.id}.`)
        }
      }
    }
    const oauth2: OAuth2ClientCredentials | undefined =
      entry.auth?.type === 'oauth2'
        ? {
            tokenUrl: parseOAuth2TokenUrl(entry.auth.tokenUrl),
            clientId: entry.auth.clientId,
            clientSecret: entry.auth.clientSecret,
            scope: entry.auth.scope,
            audience: entry.auth.audience,
            authMethod: entry.auth.authMethod ?? 'client_secret_basic',
          }
        : undefined
    const metricsUrl = entry.metricsUrl ? parseMetricsUrl(entry.metricsUrl) : undefined
    if (
      (oauth2 && isPublicDemoBackend(oauth2.tokenUrl)) ||
      (entry.metricsAuth && metricsUrl && isPublicDemoBackend(metricsUrl))
    ) {
      throw new Error('Do not configure upstream credentials for the public Gotenberg demo.')
    }
    return {
      id: entry.id,
      name: entry.name,
      url,
      authorization:
        entry.auth?.type === 'oauth2' ? undefined : authorizationFor(entry.auth, entry.id),
      oauth2,
      metricsUrl,
      metricsAuthorization: authorizationFor(entry.metricsAuth, `${entry.id} metrics`),
    }
  })
  // Legacy credentials require an explicit profile ID; URL selection never inherits them.
  const legacy = parseUpstreamBasicAuth(env, allowed)
  if (legacy) {
    connections.push({
      id: 'legacy-basic',
      name: 'Private Gotenberg (legacy)',
      url: legacy.target,
      authorization: legacy.authorization,
    })
  }
  if (new Set(connections.map((connection) => connection.id)).size !== connections.length) {
    throw new Error('Server connection IDs must be unique.')
  }
  return { connections }
}

export function publicServerConnections(connections: ServerConnection[]): PublicServerConnection[] {
  return connections.map(({ id, name }) => ({ id, name }))
}

export function requireServerConnection(
  id: string,
  connections: ServerConnection[],
): ServerConnection {
  const selected = connections.find((connection) => connection.id === id)
  if (!selected) throw new ProxyInputError('Unknown server-managed connection.', 404)
  return selected
}
