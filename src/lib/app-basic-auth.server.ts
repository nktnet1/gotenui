import { createHash, timingSafeEqual } from 'node:crypto'
import {
  isBasicPassword,
  isBasicUsername,
  MAX_BROWSER_AUTHORIZATION_LENGTH,
} from '#/lib/upstream-credentials'

type Environment = {
  GOTENUI_BASIC_AUTH_USERNAME?: string
  GOTENUI_BASIC_AUTH_PASSWORD?: string
}

type Credentials = { username: string; password: string }

/** Optional site-wide credentials, separate from per-connection upstream authentication. */
export function parseAppBasicAuth(env: Environment): Credentials | null {
  const username = env.GOTENUI_BASIC_AUTH_USERNAME
  const password = env.GOTENUI_BASIC_AUTH_PASSWORD
  // Compose may inject an empty pair when neither optional variable is supplied.
  if ((username === undefined && password === undefined) || (username === '' && password === '')) {
    return null
  }
  if (
    !username ||
    !password ||
    !username.trim() ||
    !isBasicUsername(username) ||
    !isBasicPassword(password)
  ) {
    throw new Error(
      'Configure GOTENUI_BASIC_AUTH_USERNAME and GOTENUI_BASIC_AUTH_PASSWORD together with valid values.',
    )
  }
  return { username, password }
}

/** Check the full UTF-8 credential pair using fixed-length constant-time digests. */
export function verifyAppBasicAuth(
  authorization: string | null,
  credentials: Credentials,
): boolean {
  if (!authorization || authorization.length > MAX_BROWSER_AUTHORIZATION_LENGTH) return false
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  if (!match) return false
  const encoded = match[1]
  const supplied = Buffer.from(encoded, 'base64')
  if (supplied.toString('base64') !== encoded) return false
  const expected = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8')
  const receivedHash = createHash('sha256').update(supplied).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

/** Return a challenge when site-wide authentication is configured and not satisfied. */
export function appBasicAuthChallenge(
  authorization: string | null,
  env: Environment = process.env,
): Response | undefined {
  const credentials = parseAppBasicAuth(env)
  if (!credentials || verifyAppBasicAuth(authorization, credentials)) return undefined
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Gotenui", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
