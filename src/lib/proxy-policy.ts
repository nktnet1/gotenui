import { normalizeBackendUrl } from '#/lib/backend-url'

export const DEMO_GOTENBERG_URL = 'https://demo.gotenberg.dev'
export const DEFAULT_MAX_REQUEST_BYTES = 4_200_000

/** Parse an explicit deployment-side allowlist, never an arbitrary browser-supplied hostname. */
export function parseAllowedBackends(configured: string | undefined): ReadonlySet<string> {
  const raw = configured === undefined ? DEMO_GOTENBERG_URL : configured
  const entries = raw.split(',').map((value) => value.trim())
  if (entries.length > 30 || entries.some((value) => !value)) {
    throw new Error('GOTENBERG_ALLOWED_URLS must contain one to thirty absolute URLs.')
  }
  return new Set(entries.map(normalizeBackendUrl))
}

export class ProxyInputError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message)
    this.name = 'ProxyInputError'
  }
}

/** An exact base-URL match protects against SSRF, host suffix tricks and path bypasses. */
export function requireAllowedBackend(candidate: string, allowed: ReadonlySet<string>): string {
  let normalized: string
  try {
    normalized = normalizeBackendUrl(candidate)
  } catch {
    throw new ProxyInputError('Enter a valid absolute Gotenberg URL.')
  }
  if (!allowed.has(normalized)) {
    throw new ProxyInputError('This Gotenberg URL is not approved by the server.', 403)
  }
  return normalized
}

/** Stop uploads exceeding a host's limit before multipart parsing allocates file buffers. */
export async function readLimitedBody(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new ProxyInputError('A multipart request body is required.')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        // Finish cancellation before releasing the lock; preserve the 413 if cancellation fails.
        await reader.cancel().catch(() => {})
        throw new ProxyInputError(`Request exceeds the ${limit} byte upload limit.`, 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** A form submission from another site must not turn this function into a public relay. */
export function requireSameOrigin(request: Request): void {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ProxyInputError('Cross-origin proxy requests are not allowed.', 403)
  }
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    throw new ProxyInputError('Cross-origin proxy requests are not allowed.', 403)
  }
}
