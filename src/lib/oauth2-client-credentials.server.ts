import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { ProxyInputError, readLimitedBody } from '#/lib/proxy-policy'

/** OAuth 2.0 client credentials for a deployment-managed Gotenberg connection.
 * This is not an interactive OIDC user login or a browser-stored refresh token.
 */
export type OAuth2ClientCredentials = Readonly<{
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
  audience?: string
  authMethod: 'client_secret_basic' | 'client_secret_post'
}>

const tokenResponseSchema = v.object({
  access_token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
  token_type: v.string(),
  expires_in: v.union([v.number(), v.pipe(v.string(), v.regex(/^\d+$/))]),
})

const MAX_TOKEN_BODY = 16_384
const MAX_CACHED_TOKENS = 30
const TOKEN_REQUEST_TIMEOUT_MS = 10_000

const cached = new Map<string, { authorization: string; validUntil: number }>()
const pending = new Map<string, Promise<string>>()

/** Do not make a token service URL or credentials browser-configurable. */
export function parseOAuth2TokenUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('OAuth2 tokenUrl must be an absolute HTTPS URL.')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    !url.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error('OAuth2 tokenUrl must be an HTTPS URL without credentials, query or fragment.')
  }
  return url.href
}

function fingerprint(connectionUrl: string, auth: OAuth2ClientCredentials): string {
  // A hash avoids retaining the client secret in cache keys and scopes tokens to
  // both the exact Gotenberg destination and the identity-provider configuration.
  return createHash('sha256')
    .update(JSON.stringify([connectionUrl, auth]))
    .digest('hex')
}

function rejectTokenResponse(): never {
  // Do not expose the identity provider's body, status detail, or credentials.
  throw new ProxyInputError(
    'The configured OAuth2 token endpoint could not issue a usable token.',
    502,
  )
}

async function requestToken(
  fetcher: typeof fetch,
  auth: OAuth2ClientCredentials,
  key: string,
): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (auth.scope) body.set('scope', auth.scope)
  if (auth.audience) body.set('audience', auth.audience)
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  if (auth.authMethod === 'client_secret_post') {
    body.set('client_id', auth.clientId)
    body.set('client_secret', auth.clientSecret)
  } else {
    // OAuth 2.0 client_secret_basic uses form-encoded credentials (RFC 6749 2.3.1).
    const encode = (value: string) => new URLSearchParams({ value }).toString().slice(6)
    const credentials = `${encode(auth.clientId)}:${encode(auth.clientSecret)}`
    headers.set('Authorization', `Basic ${Buffer.from(credentials).toString('base64')}`)
  }

  let response: Response
  try {
    response = await fetcher(auth.tokenUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'error',
      credentials: 'omit',
    })
  } catch {
    return rejectTokenResponse()
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    return rejectTokenResponse()
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    await response.body?.cancel().catch(() => {})
    return rejectTokenResponse()
  }

  let candidate: unknown
  try {
    const bytes = await readLimitedBody(response.body, MAX_TOKEN_BODY)
    candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return rejectTokenResponse()
  }
  const parsed = v.safeParse(tokenResponseSchema, candidate)
  if (!parsed.success || parsed.output.token_type.toLowerCase() !== 'bearer') {
    return rejectTokenResponse()
  }
  const { access_token } = parsed.output
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(access_token)) return rejectTokenResponse()
  const seconds = Number(parsed.output.expires_in)
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    return rejectTokenResponse()
  }

  const authorization = `Bearer ${access_token}`
  // Renew before expiry, including for short-lived tokens. A token with a tiny
  // lifespan can still satisfy the current request without entering the cache.
  // Limit local caching to one day even when a provider issues longer-lived tokens.
  const lifetime = Math.min(seconds, 86_400)
  const skewSeconds = Math.max(1, Math.min(60, Math.ceil(lifetime * 0.1)))
  const validUntil = Date.now() + Math.max(0, lifetime - skewSeconds) * 1000
  if (validUntil > Date.now()) {
    if (cached.size >= MAX_CACHED_TOKENS) {
      for (const [id, existing] of cached) {
        if (existing.validUntil <= Date.now()) cached.delete(id)
      }
      if (cached.size >= MAX_CACHED_TOKENS) cached.delete(cached.keys().next().value ?? '')
    }
    cached.set(key, { authorization, validUntil })
  }
  return authorization
}

export async function authorizationForOAuth2(
  connectionUrl: string,
  auth: OAuth2ClientCredentials,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const key = fingerprint(connectionUrl, auth)
  const saved = cached.get(key)
  if (saved && saved.validUntil > Date.now()) return saved.authorization
  cached.delete(key)
  const existing = pending.get(key)
  if (existing) return existing
  const tokenRequest = requestToken(fetcher, auth, key)
  pending.set(key, tokenRequest)
  try {
    return await tokenRequest
  } finally {
    if (pending.get(key) === tokenRequest) pending.delete(key)
  }
}

export function invalidateOAuth2Authorization(
  connectionUrl: string,
  auth: OAuth2ClientCredentials | undefined,
): void {
  if (auth) cached.delete(fingerprint(connectionUrl, auth))
}

/** Exported for isolated tests; this module holds no browser-side state. */
export function clearOAuth2AuthorizationCache(): void {
  cached.clear()
  pending.clear()
}
