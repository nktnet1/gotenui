import type { IncomingMessage, ServerResponse } from 'node:http'

export type CallbackReceipt = {
  kind: string
  method: string
  contentType: string
  contentDisposition: string
  trace: string | null
  traceparent: string | null
  testHeaderPresent: boolean
  beginsPdf: boolean
  event?: string
  correlationId?: string
  errorStatus?: number
}

/** Disposable local test receiver; neither Gotenui nor the product stores callbacks. */
export function asyncFixtureHandler(): (req: IncomingMessage, res: ServerResponse) => boolean {
  const callbacks = new Map<string, CallbackReceipt[]>()
  const timestampRequests = new Map<string, { hits: number; contentType: string }>()
  let pipelinePdf: Buffer | undefined
  return (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    // Deliberately unavailable local TSA: proves Gotenberg actually contacted
    // the RFC 3161 endpoint without needing a public authority or valid token.
    const tsa = /^\/gotenui-tsa\/([a-f0-9-]{36})$/.exec(path)
    if (tsa) {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return true
      }
      const token = tsa[1] ?? ''
      const old = timestampRequests.get(token)
      timestampRequests.set(token, {
        hits: (old?.hits ?? 0) + 1,
        contentType: String(req.headers['content-type'] ?? ''),
      })
      req.resume()
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('Test timestamp authority unavailable')
      return true
    }
    const tsaSnapshot = /^\/_gotenui_tsa\/([a-f0-9-]{36})$/.exec(path)
    if (tsaSnapshot) {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return true
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(
        JSON.stringify(timestampRequests.get(tsaSnapshot[1] ?? '') ?? { hits: 0, contentType: '' }),
      )
      return true
    }
    if (path === '/gotenui-remote/pipeline.pdf') {
      if (req.headers['x-gotenui-remote-token'] !== 'fixture-remote-key') {
        res.writeHead(403).end()
        return true
      }
      if (req.method === 'GET') {
        if (!pipelinePdf) {
          res.writeHead(404).end()
          return true
        }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="remote-pipeline.pdf"',
        })
        res.end(pipelinePdf)
        return true
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size <= 2_000_000) chunks.push(chunk)
          else req.destroy()
        })
        req.on('end', () => {
          const bytes = Buffer.concat(chunks)
          if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
            res.writeHead(400).end()
            return
          }
          pipelinePdf = bytes
          res.writeHead(204).end()
        })
        return true
      }
      res.writeHead(405).end()
      return true
    }
    if (path === '/gotenui-remote/document.txt') {
      if (req.headers['x-gotenui-remote-token'] !== 'fixture-remote-key') {
        res.writeHead(403).end()
        return true
      }
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="remote-input.txt"',
      })
      res.end('This Office source was fetched using Gotenberg downloadFrom.')
      return true
    }
    if (path === '/gotenui-remote/no-filename.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('Missing the required Content-Disposition filename.')
      return true
    }
    const snapshot = /^\/_gotenui_callbacks\/([a-f0-9-]{36})$/.exec(path)
    if (snapshot) {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return true
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(callbacks.get(snapshot[1] ?? '') ?? []))
      return true
    }
    const callback = /^\/gotenui-callbacks\/([a-f0-9-]{36})\/(success|error|events|retry)$/.exec(
      path,
    )
    if (!callback) return false
    const token = callback[1] ?? ''
    const kind = callback[2] ?? ''
    const chunks: Buffer[] = []
    let length = 0
    req.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length <= 1_000_000) chunks.push(chunk)
      else req.destroy()
    })
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      let decoded: unknown
      if (kind === 'error' || kind === 'events') {
        try {
          decoded = JSON.parse(body.toString('utf8'))
        } catch {
          // The integration assertion reports a missing structured event.
        }
      }
      const json =
        decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : {}
      const error =
        json.error && typeof json.error === 'object' ? (json.error as Record<string, unknown>) : {}
      const records = callbacks.get(token) ?? []
      records.push({
        kind,
        method: req.method ?? '',
        contentType: String(req.headers['content-type'] ?? ''),
        contentDisposition: String(req.headers['content-disposition'] ?? ''),
        trace:
          typeof req.headers['gotenberg-trace'] === 'string'
            ? req.headers['gotenberg-trace']
            : null,
        traceparent: typeof req.headers.traceparent === 'string' ? req.headers.traceparent : null,
        testHeaderPresent: req.headers['x-gotenui-callback-token'] === 'fixture-callback-key',
        beginsPdf: body.subarray(0, 5).toString() === '%PDF-',
        ...(typeof json.event === 'string' ? { event: json.event } : {}),
        ...(typeof json.correlationId === 'string' ? { correlationId: json.correlationId } : {}),
        ...(typeof json.status === 'number' ? { errorStatus: json.status } : {}),
        ...(typeof error.status === 'number' ? { errorStatus: error.status } : {}),
      })
      callbacks.set(token, records)
      // Retry once with HTTP 503 to prove the real callback delivery retry contract.
      res.writeHead(
        kind === 'retry' && records.filter((item) => item.kind === 'retry').length === 1
          ? 503
          : 200,
      )
      res.end()
    })
    return true
  }
}
