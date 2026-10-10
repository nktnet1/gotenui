import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(projectRoot, '.output/server/index.mjs')
const pdf = Buffer.from('%PDF-1.7\n%Gotenui smoke test\n')
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
type UpstreamRequest = { path: string; headers: IncomingHttpHeaders; body: string }
const seen: UpstreamRequest[] = []
let followedRedirects = 0
let cancelledUpstreams = 0
let cancelledPendingUpstreams = 0
let partialDiagnostic: 'health' | 'version' | 'debug' | 'metrics' | null = null

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return address.port
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

const upstream = createServer(async (request, response) => {
  try {
    if (request.url === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      if (partialDiagnostic === 'health' && request.method === 'GET') response.statusCode = 206
      response.setHeader('Content-Type', 'application/json')
      response.end(
        request.method === 'HEAD'
          ? undefined
          : JSON.stringify({ status: 'up', details: { chromium: { status: 'up' } } }),
      )
      return
    }
    if (request.url === '/version' && request.method === 'GET') {
      if (partialDiagnostic === 'version') response.statusCode = 206
      response.end('8.37.0')
      return
    }
    if (request.url === '/debug' && request.method === 'GET' && partialDiagnostic === 'debug') {
      response.writeHead(206, { 'Content-Type': 'application/json' }).end('{"enabled":true}')
      return
    }
    if (
      request.url === '/prometheus/metrics' &&
      request.method === 'GET' &&
      partialDiagnostic === 'metrics'
    ) {
      response
        .writeHead(206, { 'Content-Type': 'text/plain' })
        .end(
          '# HELP gotenberg_requests_total Requests\n# TYPE gotenberg_requests_total counter\ngotenberg_requests_total 1\n',
        )
      return
    }
    if (request.url === '/redirect-target') {
      followedRedirects++
      response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf)
      return
    }
    if (!request.url?.startsWith('/forms/') || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    assert.ok(body.byteLength < 1_000_000, 'Smoke fixture received an unexpectedly large upload')
    seen.push({
      path: request.url,
      headers: request.headers,
      body: body.toString('utf8'),
    })
    const trace = request.headers['gotenberg-trace']
    if (trace === 'smoke-pending-headers') {
      // Cancellation before the first upstream response byte must also abort fetch.
      const timer = setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf)
      }, 10_000)
      response.on('close', () => {
        clearTimeout(timer)
        if (!response.writableEnded) cancelledPendingUpstreams++
      })
      return
    }
    if (trace === 'smoke-held-stream') {
      // Keep the upstream PDF stream open until the browser cancels the download.
      response.writeHead(200, { 'Content-Type': 'application/pdf' })
      response.write(pdf)
      const timer = setTimeout(() => response.end(pdf), 10_000)
      response.on('close', () => {
        clearTimeout(timer)
        if (!response.writableEnded) cancelledUpstreams++
      })
      return
    }
    if (trace === 'smoke-truncated') {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length + 25),
      })
      response.end(pdf)
      return
    }
    if (trace === 'smoke-overlap-server' || trace === 'smoke-overlap-browser') {
      // Both browser and server-managed requests remain in flight together.
      await sleep(150)
    }
    if (trace === 'smoke-mislabeled-pdf') {
      response
        .writeHead(200, { 'Content-Type': 'application/pdf' })
        .end('<html>proxy fallback</html>')
      return
    }
    if (trace === 'smoke-pdf-missing-version') {
      // Previously accepted as a PDF because the first five magic bytes match.
      response
        .writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '5' })
        .end('%PDF-')
      return
    }
    if (trace === 'smoke-invalid-html') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>invalid</html>')
      return
    }
    if (trace === 'smoke-inline-download') {
      response
        .writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="../../invoice.html"',
          'Set-Cookie': 'upstream=secret',
        })
        .end(pdf)
      return
    }
    if (trace === 'smoke-mismatched-zip') {
      response
        .writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="old.pdf"',
        })
        .end(zip)
      return
    }
    if (trace === 'smoke-auth-error') {
      response
        .writeHead(401, {
          'Content-Type': 'text/plain',
          'Gotenberg-Trace': 'fixture-auth-rejected',
          'Set-Cookie': 'private-error-cookie=secret',
        })
        .end('Fixture authentication rejected')
      return
    }
    if (trace === 'smoke-redirect') {
      response.writeHead(302, { Location: '/redirect-target' }).end()
      return
    }
    if (trace === 'smoke-webhook') {
      response
        .writeHead(204, {
          'Gotenberg-Trace': 'fixture-webhook-accepted',
          'Content-Disposition': 'inline; filename="callback.html"',
          'Content-Type': 'text/html',
        })
        .end()
      return
    }
    if (trace === 'smoke-oversized') {
      response
        .writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '1025' })
        .end(Buffer.alloc(1025))
      return
    }
    const isZip = request.url === '/forms/libreoffice/convert'
    response.writeHead(200, {
      'Content-Type': isZip ? 'application/zip' : 'application/pdf',
      'Content-Disposition': `attachment; filename="fixture.${isZip ? 'zip' : 'pdf'}"`,
      'Gotenberg-Trace': 'fixture-response-trace',
      'Set-Cookie': 'private-upstream-cookie=secret',
    })
    response.end(isZip ? zip : pdf)
  } catch {
    response.writeHead(500).end('Fixture failed')
  }
})

function conversionBody(
  operation: string,
  fields: Record<string, unknown>,
  files: File[] = [],
  extras: Record<string, unknown> = {},
): FormData {
  const form = new FormData()
  form.set('payload', JSON.stringify({ operation, fields, advanced: {}, ...extras }))
  for (const file of files) form.append('files', file, file.name)
  return form
}

async function get(url: string, options: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(10_000)
  return fetch(url, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  })
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  await Promise.race([stopped, sleep(2_000)])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([stopped, sleep(2_000)])
  }
}

async function waitForServer(child: ChildProcess, url: string, logs: () => string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Built Nitro server exited during startup: ${logs()}`)
    }
    try {
      const response = await fetch(`${url}/api/gotenberg/connections`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Connection refused while Nitro binds its loopback listener.
    }
    await sleep(100)
  }
  throw new Error(`Built Nitro server did not become ready: ${logs()}`)
}

async function run(): Promise<void> {
  if (!existsSync(entry)) throw new Error('Missing .output/server/index.mjs; run pnpm build first.')
  const upstreamPort = await listen(upstream)
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`
  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    NODE_ENV: 'production',
    GOTENBERG_ALLOWED_URLS: upstreamUrl,
    GOTENUI_SERVER_CONNECTIONS: JSON.stringify([
      {
        id: 'smoke',
        name: 'Release smoke instance',
        url: upstreamUrl,
        auth: { type: 'bearer', token: 'server-only-smoke-token' },
      },
    ]),
    GOTENUI_SHOW_DEBUG: 'false',
    GOTENUI_SHOW_METRICS: 'false',
    GOTENUI_MAX_RESPONSE_BYTES: '1024',
    GOTENUI_PUBLIC_ORIGIN: undefined,
  }
  const child = spawn(process.execPath, [entry], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-4_000)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  let checks = 0
  try {
    await waitForServer(child, origin, () => output)

    const page = await get(`${origin}/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type') ?? '', /^text\/html/)
    assert.match(await page.text(), /Gotenui/)
    checks++

    const logo = await get(`${origin}/gotenui-icon.svg`)
    assert.equal(logo.status, 200)
    assert.match(logo.headers.get('content-type') ?? '', /image\/svg\+xml/)
    assert.match(await logo.text(), /<svg\b/)
    checks++

    const connections = await get(`${origin}/api/gotenberg/connections`)
    assert.equal(connections.status, 200)
    assert.match(connections.headers.get('content-type') ?? '', /^application\/json/)
    assert.equal(connections.headers.get('cache-control'), 'no-store')
    const profiles = await connections.json()
    assert.deepEqual(profiles, {
      connections: [{ id: 'smoke', name: 'Release smoke instance' }],
      features: { showDebug: false, showMetrics: false },
    })
    assert.doesNotMatch(JSON.stringify(profiles), /server-only-smoke-token|127\.0\.0\.1/)
    checks++

    const health = await get(`${origin}/api/gotenberg/health?connection=smoke`, {
      method: 'HEAD',
    })
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('x-gotenui-health-probe'), '1')
    assert.equal(await health.text(), '')
    checks++

    const status = await get(`${origin}/api/gotenberg/status?connection=smoke`)
    assert.equal(status.status, 200)
    const details = await status.json()
    assert.equal(details.online, true)
    assert.equal(details.version, '8.37.0')
    checks++

    const convertUrl = `${origin}/api/gotenberg/convert`
    const baseFields = { url: 'https://example.test/smoke' }
    const sameOrigin = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }
    for (const route of ['health', 'version', 'debug', 'metrics'] as const) {
      partialDiagnostic = route
      try {
        if (route === 'health' || route === 'version') {
          const response = await get(`${origin}/api/gotenberg/status?connection=smoke`)
          assert.equal(response.status, 200)
          const payload = await response.json()
          if (route === 'health') assert.equal(payload.online, false)
          else {
            assert.equal(payload.online, true)
            assert.equal(payload.version, 'Unknown')
          }
        } else {
          const response = await get(`${origin}/api/gotenberg/${route}`, {
            method: 'POST',
            headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
          })
          assert.equal(response.status, 502)
          assert.match(await response.text(), /HTTP 206/)
        }
        checks++
      } finally {
        partialDiagnostic = null
      }
    }
    const pdfRequest = () => conversionBody('url-pdf', baseFields)
    const converted = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], {
        outputName: 'release-smoke',
        requestTrace: 'smoke-request',
      }),
    })
    assert.equal(converted.status, 200)
    assert.equal(converted.headers.get('content-type'), 'application/pdf')
    assert.equal(converted.headers.get('gotenberg-trace'), 'fixture-response-trace')
    assert.equal(
      converted.headers.get('content-disposition'),
      'attachment; filename="release-smoke.pdf"',
    )
    assert.equal(converted.headers.get('set-cookie'), null)
    assert.deepEqual(Buffer.from(await converted.arrayBuffer()), pdf)
    const serverRequest = seen.at(-1)
    assert.ok(serverRequest, 'Expected a server-managed upstream request')
    assert.equal(serverRequest.path, '/forms/chromium/convert/url')
    assert.equal(serverRequest.headers.authorization, 'Bearer server-only-smoke-token')
    assert.equal(serverRequest.headers['gotenberg-output-filename'], 'release-smoke')
    assert.equal(serverRequest.headers['gotenberg-trace'], 'smoke-request')
    assert.match(serverRequest.body, /name="url"/)
    checks++

    // Reverse proxies can quote the standard multipart boundary and include
    // an explicit charset. The built Nitro route must accept this valid form.
    const encodedMultipart = new Request(convertUrl, { method: 'POST', body: pdfRequest() })
    const unquotedType = encodedMultipart.headers.get('content-type')
    assert.ok(unquotedType)
    assert.ok(unquotedType.startsWith('multipart/form-data; boundary='))
    const quotedType = `${unquotedType.replace('boundary=', 'charset=UTF-8; boundary="')}"`
    const quotedMultipart = await get(convertUrl, {
      method: 'POST',
      headers: {
        ...sameOrigin,
        'X-Gotenui-Connection-Id': 'smoke',
        'Content-Type': quotedType,
      },
      body: await encodedMultipart.arrayBuffer(),
    })
    assert.equal(quotedMultipart.status, 200)
    assert.deepEqual(Buffer.from(await quotedMultipart.arrayBuffer()), pdf)
    checks++

    const browser = await get(convertUrl, {
      method: 'POST',
      headers: {
        ...sameOrigin,
        'X-Gotenberg-Url': upstreamUrl,
        'X-Gotenui-Upstream-Authorization': 'Bearer browser-smoke-token',
      },
      body: pdfRequest(),
    })
    assert.equal(browser.status, 200)
    assert.deepEqual(Buffer.from(await browser.arrayBuffer()), pdf)
    const browserRequest = seen.at(-1)
    assert.ok(browserRequest, 'Expected a browser-managed upstream request')
    assert.equal(browserRequest.headers.authorization, 'Bearer browser-smoke-token')
    checks++

    const [serverOverlap, browserOverlap] = await Promise.all([
      get(convertUrl, {
        method: 'POST',
        headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
        body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-overlap-server' }),
      }),
      get(convertUrl, {
        method: 'POST',
        headers: {
          ...sameOrigin,
          'X-Gotenberg-Url': upstreamUrl,
          'X-Gotenui-Upstream-Authorization': 'Bearer browser-smoke-token',
        },
        body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-overlap-browser' }),
      }),
    ])
    assert.equal(serverOverlap.status, 200)
    assert.equal(browserOverlap.status, 200)
    await Promise.all([serverOverlap.arrayBuffer(), browserOverlap.arrayBuffer()])
    const overlapped = seen.filter((item) =>
      ['smoke-overlap-server', 'smoke-overlap-browser'].includes(
        String(item.headers['gotenberg-trace']),
      ),
    )
    assert.equal(overlapped.length, 2)
    assert.equal(
      overlapped.find((item) => item.headers['gotenberg-trace'] === 'smoke-overlap-server')?.headers
        .authorization,
      'Bearer server-only-smoke-token',
    )
    assert.equal(
      overlapped.find((item) => item.headers['gotenberg-trace'] === 'smoke-overlap-browser')
        ?.headers.authorization,
      'Bearer browser-smoke-token',
    )
    checks++

    const pendingAbort = new AbortController()
    const waiting = get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-pending-headers' }),
      signal: pendingAbort.signal,
    })
    // Observe the rejection immediately, even when startup fails before the assertion.
    void waiting.catch(() => {})
    const pendingDeadline = Date.now() + 3_000
    while (
      !seen.some((item) => item.headers['gotenberg-trace'] === 'smoke-pending-headers') &&
      Date.now() < pendingDeadline
    ) {
      await sleep(40)
    }
    assert.ok(
      seen.some((item) => item.headers['gotenberg-trace'] === 'smoke-pending-headers'),
      'Pending request must reach the upstream before cancellation',
    )
    const pendingStarted = Date.now()
    pendingAbort.abort()
    await assert.rejects(waiting)
    assert.ok(Date.now() - pendingStarted < 5_000, 'Abort must not wait for the 10s timeout')
    const pendingCloseDeadline = Date.now() + 3_000
    while (cancelledPendingUpstreams === 0 && Date.now() < pendingCloseDeadline) await sleep(40)
    assert.equal(
      cancelledPendingUpstreams,
      1,
      'Cancelling a pending client request must stop the upstream request',
    )
    checks++

    const streamAbort = new AbortController()
    const held = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-held-stream' }),
      signal: streamAbort.signal,
    })
    assert.equal(held.status, 200)
    const heldReader = held.body?.getReader()
    assert.ok(heldReader)
    const firstChunk = await heldReader.read()
    assert.ok(firstChunk.value?.length)
    const streamingStarted = Date.now()
    streamAbort.abort()
    await assert.rejects(heldReader.read())
    assert.ok(Date.now() - streamingStarted < 5_000, 'Stream abort must be prompt')
    const abortDeadline = Date.now() + 3_000
    while (cancelledUpstreams === 0 && Date.now() < abortDeadline) await sleep(40)
    assert.equal(cancelledUpstreams, 1, 'Closing a client download must cancel the upstream stream')
    checks++

    const truncated = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-truncated' }),
    })
    assert.equal(truncated.status, 200)
    await assert.rejects(truncated.arrayBuffer(), /terminated|truncated|aborted|failed|error/i)
    checks++

    const split = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('split', { splitMode: 'intervals', splitSpan: '1' }, [
        new File(['%PDF-1.7'], 'source.pdf', { type: 'application/pdf' }),
      ]),
    })
    assert.equal(split.status, 200)
    assert.equal(split.headers.get('content-type'), 'application/pdf')
    assert.deepEqual(Buffer.from(await split.arrayBuffer()), pdf)
    checks++

    const office = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('office-pdf', {}, [
        new File(['A'], 'first.txt', { type: 'text/plain' }),
        new File(['B'], 'second.txt', { type: 'text/plain' }),
      ]),
    })
    assert.equal(office.status, 200)
    assert.equal(office.headers.get('content-type'), 'application/zip')
    assert.deepEqual(Buffer.from(await office.arrayBuffer()), zip)
    checks++

    const hostileName = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-inline-download' }),
    })
    assert.equal(hostileName.status, 200)
    assert.equal(
      hostileName.headers.get('content-disposition'),
      'attachment; filename="invoice.pdf"',
    )
    assert.equal(hostileName.headers.get('set-cookie'), null)
    assert.deepEqual(Buffer.from(await hostileName.arrayBuffer()), pdf)
    checks++

    const misnamedZip = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody(
        'office-pdf',
        {},
        [
          new File(['A'], 'first.txt', { type: 'text/plain' }),
          new File(['B'], 'second.txt', { type: 'text/plain' }),
        ],
        { requestTrace: 'smoke-mismatched-zip' },
      ),
    })
    assert.equal(misnamedZip.status, 200)
    assert.equal(misnamedZip.headers.get('content-disposition'), 'attachment; filename="old.zip"')
    assert.deepEqual(Buffer.from(await misnamedZip.arrayBuffer()), zip)
    checks++

    for (const [trace, expected] of [
      ['smoke-invalid-html', /unexpected conversion response/],
      ['smoke-oversized', /exceeds.*byte limit/],
    ] as const) {
      const invalid = await get(convertUrl, {
        method: 'POST',
        headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
        body: conversionBody('url-pdf', baseFields, [], { requestTrace: trace }),
      })
      assert.equal(invalid.status, 502)
      assert.match(await invalid.text(), expected)
      checks++
    }

    const mislabeled = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-mislabeled-pdf' }),
    })
    assert.equal(mislabeled.status, 502)
    assert.match(await mislabeled.text(), /does not match its declared file type/)
    checks++

    const missingVersion = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], {
        requestTrace: 'smoke-pdf-missing-version',
      }),
    })
    assert.equal(missingVersion.status, 502)
    assert.match(await missingVersion.text(), /inconsistent response length|file type/)
    checks++

    const rejectedAuth = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-auth-error' }),
    })
    assert.equal(rejectedAuth.status, 401)
    assert.equal(rejectedAuth.headers.get('gotenberg-trace'), 'fixture-auth-rejected')
    assert.equal(rejectedAuth.headers.get('set-cookie'), null)
    assert.equal(await rejectedAuth.text(), 'Fixture authentication rejected')
    checks++

    const redirect = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], { requestTrace: 'smoke-redirect' }),
    })
    assert.equal(redirect.status, 502)
    assert.equal(redirect.headers.get('location'), null)
    assert.equal(followedRedirects, 0, 'Upstream redirects must never be followed')
    assert.match(await redirect.text(), /Gotenberg proxy failed/)
    checks++

    const accepted = await get(convertUrl, {
      method: 'POST',
      headers: { ...sameOrigin, 'X-Gotenui-Connection-Id': 'smoke' },
      body: conversionBody('url-pdf', baseFields, [], {
        requestTrace: 'smoke-webhook',
        webhook: { url: 'https://hooks.example.test/result', method: 'POST' },
      }),
    })
    assert.equal(accepted.status, 204)
    assert.equal(accepted.headers.get('gotenberg-trace'), 'fixture-webhook-accepted')
    assert.equal(accepted.headers.get('content-disposition'), null)
    assert.equal(accepted.headers.get('content-type'), null)
    assert.equal(await accepted.text(), '')
    assert.equal(seen.at(-1)?.headers['gotenberg-webhook-url'], 'https://hooks.example.test/result')
    checks++

    const previousCount = seen.length
    for (const headers of [
      { ...sameOrigin, Origin: 'https://evil.example', 'X-Gotenui-Connection-Id': 'smoke' },
      { ...sameOrigin, 'Sec-Fetch-Site': 'cross-site', 'X-Gotenui-Connection-Id': 'smoke' },
      { ...sameOrigin, 'X-Gotenberg-Url': 'http://127.0.0.1:1' },
    ]) {
      const rejected = await get(convertUrl, { method: 'POST', headers, body: pdfRequest() })
      assert.equal(rejected.status, 403)
      checks++
    }
    const conflicting = await get(convertUrl, {
      method: 'POST',
      headers: {
        ...sameOrigin,
        'X-Gotenui-Connection-Id': 'smoke',
        'X-Gotenui-Upstream-Authorization': 'Bearer browser-smoke-token',
      },
      body: pdfRequest(),
    })
    assert.equal(conflicting.status, 400)
    assert.equal(seen.length, previousCount, 'Rejected requests must never reach upstream')
    checks++

    // A TLS-terminating ingress can forward a public HTTPS Origin to an HTTP
    // Nitro listener. Verify the explicitly configured origin without trusting
    // client-supplied X-Forwarded-Host or X-Forwarded-Proto.
    const proxiedPort = await unusedPort()
    const proxiedOrigin = `http://127.0.0.1:${proxiedPort}`
    const publicOrigin = 'https://documents.example.test'
    const proxiedChild = spawn(process.execPath, [entry], {
      cwd: projectRoot,
      env: {
        ...env,
        PORT: String(proxiedPort),
        NITRO_PORT: String(proxiedPort),
        GOTENUI_PUBLIC_ORIGIN: publicOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let proxiedLogs = ''
    const captureProxy = (chunk: Buffer) => {
      proxiedLogs = `${proxiedLogs}${chunk.toString()}`.slice(-4_000)
    }
    proxiedChild.stdout.on('data', captureProxy)
    proxiedChild.stderr.on('data', captureProxy)
    try {
      await waitForServer(proxiedChild, proxiedOrigin, () => proxiedLogs)
      const proxiedConvert = `${proxiedOrigin}/api/gotenberg/convert`
      const proxyHeaders = {
        Origin: publicOrigin,
        'Sec-Fetch-Site': 'same-origin',
        'X-Gotenui-Connection-Id': 'smoke',
      }
      const acceptedPublic = await get(proxiedConvert, {
        method: 'POST',
        headers: proxyHeaders,
        body: pdfRequest(),
      })
      assert.equal(acceptedPublic.status, 200)
      assert.deepEqual(Buffer.from(await acceptedPublic.arrayBuffer()), pdf)
      checks++

      const beforeRejections = seen.length
      for (const headers of [
        { ...proxyHeaders, Origin: proxiedOrigin },
        {
          ...proxyHeaders,
          Origin: 'https://attacker.example.test',
          'X-Forwarded-Host': 'documents.example.test',
          'X-Forwarded-Proto': 'https',
        },
        { ...proxyHeaders, 'Sec-Fetch-Site': 'cross-site' },
      ]) {
        const rejected = await get(proxiedConvert, {
          method: 'POST',
          headers,
          body: pdfRequest(),
        })
        assert.equal(rejected.status, 403)
        checks++
      }
      assert.equal(seen.length, beforeRejections, 'Cross-origin traffic must not reach Gotenberg')
    } finally {
      await stopProcess(proxiedChild)
    }

    console.log(`Production Nitro smoke: ${styleText('green', 'PASS')} (${checks} checks)`)
  } finally {
    await stopProcess(child)
    upstream.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

run().catch((error) => {
  console.error(`Production Nitro smoke: ${styleText('red', 'FAIL')}`)
  console.error(error)
  process.exitCode = 1
})
