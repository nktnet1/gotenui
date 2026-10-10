import { createHash, timingSafeEqual } from 'node:crypto'
import { ProxyInputError } from '#/lib/proxy-policy'

const MIN_KEY_LENGTH = 32
const MAX_KEY_LENGTH = 4096

/** Debug data includes runtime flags; it must never be available to anonymous proxy clients. */
export function requireDebugAccess(request: Request, configuredKey: string | undefined): void {
  if (configuredKey === undefined) {
    throw new ProxyInputError('Debug diagnostics are not enabled on this Gotenui deployment.', 404)
  }
  if (configuredKey.length < MIN_KEY_LENGTH || configuredKey.length > MAX_KEY_LENGTH) {
    throw new Error('GOTENUI_DEBUG_ACCESS_KEY must contain 32 to 4096 characters.')
  }

  const suppliedKey = request.headers.get('x-gotenui-debug-access-key')
  if (!suppliedKey || suppliedKey.length > MAX_KEY_LENGTH) {
    throw new ProxyInputError('A valid Gotenui debug access key is required.', 403)
  }
  // Hash fixed-size inputs to avoid revealing the expected key length through comparison.
  const suppliedDigest = createHash('sha256').update(suppliedKey).digest()
  const configuredDigest = createHash('sha256').update(configuredKey).digest()
  if (!timingSafeEqual(suppliedDigest, configuredDigest)) {
    throw new ProxyInputError('A valid Gotenui debug access key is required.', 403)
  }
}
