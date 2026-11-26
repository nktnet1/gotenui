import * as v from 'valibot'
import { normalizeBackendUrl } from '#/lib/backend-url'
import { DEMO_GOTENBERG_URL } from '#/lib/proxy-policy'
import {
  isBasicPassword,
  isBasicUsername,
  MAX_BASIC_PASSWORD_LENGTH,
  MAX_BASIC_USERNAME_LENGTH,
} from '#/lib/upstream-credentials'

const basicAuthEnvSchema = v.object({
  GOTENBERG_BASIC_AUTH_URL: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  GOTENBERG_BASIC_AUTH_USERNAME: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(MAX_BASIC_USERNAME_LENGTH),
  ),
  GOTENBERG_BASIC_AUTH_PASSWORD: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(MAX_BASIC_PASSWORD_LENGTH),
  ),
})

export type UpstreamBasicAuth = Readonly<{
  target: string
  authorization: string
}>

/**
 * Optional deployment-side credentials, bound to ONE exact approved base URL.
 * Never accept username/password from browser headers, queries or localStorage.
 */
export function parseUpstreamBasicAuth(
  env: NodeJS.ProcessEnv,
  allowed: ReadonlySet<string>,
): UpstreamBasicAuth | undefined {
  const values = [
    env.GOTENBERG_BASIC_AUTH_URL,
    env.GOTENBERG_BASIC_AUTH_USERNAME,
    env.GOTENBERG_BASIC_AUTH_PASSWORD,
  ]
  if (values.every((value) => value === undefined)) return undefined
  if (values.some((value) => !value)) {
    throw new Error('Configure all three GOTENBERG_BASIC_AUTH_* variables together.')
  }

  const parsed = v.safeParse(basicAuthEnvSchema, env)
  if (!parsed.success) throw new Error('Invalid GOTENBERG_BASIC_AUTH_* configuration.')
  const { GOTENBERG_BASIC_AUTH_URL, GOTENBERG_BASIC_AUTH_USERNAME, GOTENBERG_BASIC_AUTH_PASSWORD } =
    parsed.output
  if (
    !isBasicUsername(GOTENBERG_BASIC_AUTH_USERNAME) ||
    !isBasicPassword(GOTENBERG_BASIC_AUTH_PASSWORD)
  ) {
    throw new Error('Invalid GOTENBERG_BASIC_AUTH_* username or password.')
  }

  const target = normalizeBackendUrl(GOTENBERG_BASIC_AUTH_URL)
  if (target === DEMO_GOTENBERG_URL) {
    throw new Error('Do not configure upstream Basic Auth for the public Gotenberg demo.')
  }
  if (!allowed.has(target)) {
    throw new Error('GOTENBERG_BASIC_AUTH_URL must exactly match an allowed Gotenberg base URL.')
  }

  return {
    target,
    authorization: `Basic ${Buffer.from(`${GOTENBERG_BASIC_AUTH_USERNAME}:${GOTENBERG_BASIC_AUTH_PASSWORD}`, 'utf8').toString('base64')}`,
  }
}

/** Never send credentials to any other approved backend, including the public demo. */
export function basicAuthHeadersForBackend(
  backend: string,
  auth: UpstreamBasicAuth | undefined,
): HeadersInit | undefined {
  return backend !== DEMO_GOTENBERG_URL && auth?.target === backend
    ? { Authorization: auth.authorization }
    : undefined
}
