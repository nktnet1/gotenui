import { authorizationForOAuth2 } from '#/lib/oauth2-client-credentials.server'
import { DEMO_GOTENBERG_URL, ProxyInputError, requireAllowedBackend } from '#/lib/proxy-policy'
import { requireServerConnection, type ServerConnection } from '#/lib/server-connections.server'

export type TargetSettings = {
  allowed: ReadonlySet<string>
  connections: ServerConnection[]
}

/** A browser-supplied Authorization header is never forwarded without validation. */
export function parseBrowserAuthorization(value: string | null): string | undefined {
  if (value === null) return undefined
  if (value.length > 5500 || value.length === 0 || /[\r\n]/.test(value)) {
    throw new ProxyInputError('Invalid upstream authentication header.')
  }
  if (value.startsWith('Basic ')) {
    const encoded = value.slice(6)
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new ProxyInputError('Invalid Basic Auth encoding.')
    }
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const delimiter = decoded.indexOf(':')
    if (
      delimiter < 1 ||
      delimiter > 255 ||
      decoded.length > 2304 ||
      delimiter === decoded.length - 1
    ) {
      throw new ProxyInputError('Invalid Basic Auth username or password.')
    }
    return value
  }
  if (value.startsWith('Bearer ') && /^[A-Za-z0-9._~+/-]+=*$/.test(value.slice(7))) {
    return value
  }
  throw new ProxyInputError('Only Basic and Bearer upstream authentication is supported.')
}

export function resolveConnectionTarget(
  request: Request,
  settings: TargetSettings,
  urlCandidate: string | null,
  idCandidate: string | null,
): { url: string; headers?: HeadersInit } {
  const suppliedAuth = request.headers.get('x-gotenui-upstream-authorization')
  if (request.headers.has('x-gotenui-profile-access-key')) {
    throw new ProxyInputError('Gotenui profile access keys are no longer supported.')
  }
  if (idCandidate !== null) {
    if (urlCandidate !== null || suppliedAuth !== null) {
      throw new ProxyInputError('Server connections cannot override their URL or credentials.')
    }
    const selected = requireServerConnection(idCandidate, settings.connections)
    return {
      url: selected.url,
      headers: selected.authorization ? { Authorization: selected.authorization } : undefined,
    }
  }
  const url = requireAllowedBackend(urlCandidate ?? DEMO_GOTENBERG_URL, settings.allowed)
  const authorization = parseBrowserAuthorization(suppliedAuth)
  if (authorization && url === DEMO_GOTENBERG_URL) {
    throw new ProxyInputError('Do not send credentials to the public Gotenberg demo.')
  }
  return { url, headers: authorization ? { Authorization: authorization } : undefined }
}

/** Resolve deployment-managed OAuth2 only after all proxy URL and credential
 * override checks have passed. The token is never returned in public metadata.
 */
async function abortableToken<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export async function resolveAuthenticatedConnectionTarget(
  request: Request,
  settings: TargetSettings,
  urlCandidate: string | null,
  idCandidate: string | null,
  fetcher: typeof fetch = fetch,
  authorizeOAuth2 = true,
): Promise<{ url: string; headers?: HeadersInit; oauth2?: ServerConnection['oauth2'] }> {
  const target = resolveConnectionTarget(request, settings, urlCandidate, idCandidate)
  if (idCandidate === null) return target
  const connection = requireServerConnection(idCandidate, settings.connections)
  if (!authorizeOAuth2 || !connection.oauth2) return target
  if (request.signal.aborted) throw request.signal.reason
  const authorization = await abortableToken(
    authorizationForOAuth2(connection.url, connection.oauth2, fetcher),
    request.signal,
  )
  return { ...target, headers: { Authorization: authorization }, oauth2: connection.oauth2 }
}
