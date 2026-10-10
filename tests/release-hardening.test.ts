import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  proxyConversionRequest,
  proxyErrorResponse,
  proxyStatusRequest,
} from '#/lib/gotenberg-proxy.server'
import { DEFAULT_MAX_RESPONSE_BYTES } from '#/lib/proxy-policy'

const origin = 'https://app.example.test'
const backend = 'http://127.0.0.1:3000'

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

function requestFor(
  operation = 'url-pdf',
  fields: Record<string, string | boolean> = { url: 'https://example.test' },
  headers: Record<string, string> = {},
  files: File[] = [],
  additional: Record<string, unknown> = {},
) {
  const body = new FormData()
  body.set('payload', JSON.stringify({ operation, fields, advanced: {}, ...additional }))
  for (const file of files) body.append('files', file, file.name)
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend, ...headers },
    body,
  })
}

function pdfResponse(bytes = '%PDF-1.7', headers: HeadersInit = {}) {
  return new Response(bytes, {
    headers: { 'Content-Type': 'application/pdf', ...Object.fromEntries(new Headers(headers)) },
  })
}

test('the conversion proxy honours a configured public HTTPS origin behind an internal HTTP hop', async () => {
  const publicOrigin = 'https://documents.example.test'
  vi.stubEnv('GOTENUI_PUBLIC_ORIGIN', publicOrigin)
  let upstreamCalls = 0
  const request = (origin: string, headers: Record<string, string> = {}) => {
    const form = new FormData()
    form.set(
      'payload',
      JSON.stringify({
        operation: 'url-pdf',
        fields: { url: 'https://example.test' },
        advanced: {},
      }),
    )
    return new Request('http://127.0.0.1:3100/api/gotenberg/convert', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'X-Gotenberg-Url': backend,
        ...headers,
      },
      body: form,
    })
  }
  const fetcher: typeof fetch = async () => {
    upstreamCalls++
    return pdfResponse()
  }
  const accepted = await proxyConversionRequest(request(publicOrigin), fetcher)
  assert.equal(accepted.status, 200)
  assert.equal(await accepted.text(), '%PDF-1.7')
  assert.equal(upstreamCalls, 1)

  for (const rejectedOrigin of ['http://127.0.0.1:3100', 'https://evil.example.test']) {
    const rejected = await proxyConversionRequest(
      request(rejectedOrigin, {
        'X-Forwarded-Host': 'documents.example.test',
        'X-Forwarded-Proto': 'https',
      }),
      fetcher,
    ).catch(proxyErrorResponse)
    assert.equal(rejected.status, 403)
  }
  assert.equal(upstreamCalls, 1, 'Origin rejection must precede the upstream request')
})

test('conversion output has a finite configurable streaming limit', () => {
  assert.equal(DEFAULT_MAX_RESPONSE_BYTES, 100_000_000)
})

test.each([400, 401, 403, 409, 500, 503])(
  'upstream HTTP %i is preserved without forwarding arbitrary or credential headers',
  async (status) => {
    const response = await proxyConversionRequest(
      requestFor(),
      async () =>
        new Response('Conversion failed', {
          status,
          headers: {
            'WWW-Authenticate': 'Basic realm="private"',
            'Set-Cookie': 'session=secret',
            Authorization: 'Bearer secret',
            'Gotenberg-Trace': 'error-trace',
          },
        }),
    )
    assert.equal(response.status, status)
    assert.equal(await response.text(), 'Conversion failed')
    assert.equal(response.headers.get('gotenberg-trace'), 'error-trace')
    for (const key of ['set-cookie', 'authorization', 'www-authenticate']) {
      assert.equal(response.headers.get(key), null)
    }
  },
)

test.each([
  ['text/html', '<html>SPA fallback</html>'],
  ['application/json', '{}'],
  ['text/plain', '%PDF'],
  ['', 'not a PDF'],
])('rejects upstream PDF success with %s content type', async (type, body) => {
  const response = await proxyConversionRequest(
    requestFor(),
    async () => new Response(body, { headers: type ? { 'Content-Type': type } : {} }),
  ).catch(proxyErrorResponse)
  assert.equal(response.status, 502)
  assert.match(await response.text(), /unexpected conversion response/)
})

test('status probes do not reflect network exception messages or excessively large replies', async () => {
  const request = new Request(`${origin}/api/gotenberg/status?url=${encodeURIComponent(backend)}`)
  const thrown = await proxyStatusRequest(request, async () => {
    throw new Error('Authorization: Bearer sensitive-upstream-token')
  })
  const parsed = await thrown.json()
  assert.equal(parsed.online, false)
  assert.doesNotMatch(JSON.stringify(parsed), /sensitive-upstream-token|Authorization/)

  const huge = await proxyStatusRequest(request, async () =>
    Response.json(
      { status: 'up', details: { oversized: 'x'.repeat(150_000) } },
      { headers: { 'Content-Length': '150100' } },
    ),
  )
  const result = await huge.json()
  assert.equal(result.online, false)
  assert.match(result.error, /size limit/)
})

test('screenshots must return the selected image content type', async () => {
  const response = await proxyConversionRequest(
    requestFor('url-shot', { url: 'https://example.test', format: 'webp' }),
    async () => new Response('RIFFxxxxWEBPdata', { headers: { 'Content-Type': 'image/webp' } }),
  )
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'RIFFxxxxWEBPdata')
  const mismatch = await proxyConversionRequest(
    requestFor('url-shot', { url: 'https://example.test', format: 'webp' }),
    async () => new Response('PNG', { headers: { 'Content-Type': 'image/png' } }),
  ).catch(proxyErrorResponse)
  assert.equal(mismatch.status, 502)
})

function inputPdf(name: string) {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' })
}

function conversionResult(type: string, data: string) {
  return new Response(data, {
    headers: {
      'Content-Type': `${type}; charset=binary`,
      'Content-Disposition': `attachment; filename="upstream.${type === 'application/zip' ? 'zip' : 'pdf'}"`,
      'Gotenberg-Trace': 'response-test',
    },
  })
}

const splitSuccessCases: {
  description: string
  fields: Record<string, string | boolean>
  type: string
  data: string
}[] = [
  {
    description: 'single-result intervals',
    fields: { splitMode: 'intervals', splitSpan: '1' },
    type: 'application/pdf',
    data: '%PDF-1.7',
  },
  {
    description: 'multiple-result intervals',
    fields: { splitMode: 'intervals', splitSpan: '1' },
    type: 'application/zip',
    data: 'PK\u0003\u0004',
  },
  {
    description: 'unified page ranges',
    fields: { splitMode: 'pages', splitSpan: '1', splitUnify: true },
    type: 'application/pdf',
    data: '%PDF-1.7',
  },
]

test.each(splitSuccessCases)('split $description accepts $type', async ({ fields, type, data }) => {
  const response = await proxyConversionRequest(
    requestFor('split', fields, {}, [inputPdf('source.pdf')]),
    async () => conversionResult(type, data),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), `${type}; charset=binary`)
  assert.equal(
    response.headers.get('content-disposition'),
    `attachment; filename="upstream.${type === 'application/zip' ? 'zip' : 'pdf'}"`,
  )
  assert.equal(response.headers.get('gotenberg-trace'), 'response-test')
  assert.equal(await response.text(), data)
})

test.each([
  ['split', { splitMode: 'intervals', splitSpan: '1' }, [inputPdf('source.pdf')]],
  ['merge', {}, [inputPdf('one.pdf'), inputPdf('two.pdf')]],
  ['url-pdf', { url: 'https://example.test' }, []],
] as const)('rejects a disallowed ZIP/HTML response for %s', async (operation, fields, files) => {
  const invalidType = operation === 'split' ? 'text/html' : 'application/zip'
  const response = await proxyConversionRequest(
    requestFor(operation, fields, {}, [...files]),
    async () => conversionResult(invalidType, '<html>not a conversion</html>'),
  ).catch(proxyErrorResponse)
  assert.equal(response.status, 502)
  assert.match(await response.text(), /unexpected conversion response/)
})

test.each([
  ['office-pdf', {}, ['one.txt', 'two.txt']],
  ['pdfa', { pdfa: 'PDF/A-2b' }, ['one.pdf', 'two.pdf']],
  ['rotate', { rotateAngle: '90' }, ['one.pdf', 'two.pdf']],
] as const)('accepts ZIP for multiple %s documents', async (operation, fields, names) => {
  const uploads = names.map((name) =>
    name.endsWith('.pdf') ? inputPdf(name) : new File(['office text'], name),
  )
  const response = await proxyConversionRequest(
    requestFor(operation, fields, {}, uploads),
    async () => conversionResult('application/zip', 'PK\u0003\u0004'),
  )
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/zip')
  assert.equal(await response.text(), 'PK\u0003\u0004')
})

test('remote primary documents count towards multi-document ZIP responses', async () => {
  const response = await proxyConversionRequest(
    requestFor('office-pdf', {}, {}, [new File(['office text'], 'one.txt')], {
      downloadFrom: [{ url: 'https://files.example.test/two.txt' }],
    }),
    async () => conversionResult('application/zip', 'PK\u0003\u0004'),
  )
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/zip')
})

test('embedded remote attachments do not permit ZIP as an ordinary single PDF conversion', async () => {
  const response = await proxyConversionRequest(
    requestFor('office-pdf', {}, {}, [new File(['office text'], 'one.txt')], {
      downloadFrom: [{ url: 'https://files.example.test/attachment.txt', field: 'embedded' }],
    }),
    async () => conversionResult('application/zip', 'PK\u0003\u0004'),
  ).catch(proxyErrorResponse)
  assert.equal(response.status, 502)
})

test('PDF conversion with a requested post-processing split may return ZIP', async () => {
  const response = await proxyConversionRequest(
    requestFor('url-pdf', { url: 'https://example.test' }, {}, [], {
      advanced: { splitMode: 'intervals', splitSpan: '1' },
    }),
    async () => conversionResult('application/zip', 'PK\u0003\u0004'),
  )
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/zip')
})

test('rejects successful non-200 conversions and acceptance without a webhook', async () => {
  for (const status of [202, 204, 206]) {
    const upstream = async () =>
      status === 206
        ? new Response('partial', { status, headers: { 'Content-Type': 'application/pdf' } })
        : new Response(null, { status })
    const response = await proxyConversionRequest(requestFor(), upstream).catch(proxyErrorResponse)
    assert.equal(response.status, 502)
  }
})

test('oversized advertised and invalid response lengths fail before download', async () => {
  vi.stubEnv('GOTENUI_MAX_RESPONSE_BYTES', '1024')
  for (const length of ['1025', '-1', 'abc', '9007199254740993']) {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const response = await proxyConversionRequest(
      requestFor(),
      async () =>
        new Response(stream, {
          headers: { 'Content-Type': 'application/pdf', 'Content-Length': length },
        }),
    ).catch(proxyErrorResponse)
    assert.equal(response.status, 502, length)
    assert.equal(cancelled, true, length)
  }
})

test('empty successful conversions fail, including an advertised zero byte response', async () => {
  const zero = await proxyConversionRequest(requestFor(), async () =>
    pdfResponse('', { 'Content-Length': '0' }),
  ).catch(proxyErrorResponse)
  assert.equal(zero.status, 502)
  const absent = await proxyConversionRequest(requestFor(), async () => pdfResponse('')).catch(
    proxyErrorResponse,
  )
  assert.equal(absent.status, 502)
  assert.match(await absent.text(), /does not match its declared file type/)
})

test('decoded compressed transfers do not compare compressed Content-Length with decoded bytes', async () => {
  const response = await proxyConversionRequest(requestFor(), async () =>
    pdfResponse('%PDF-1.7', { 'Content-Encoding': 'gzip', 'Content-Length': '5' }),
  )
  assert.equal(await response.text(), '%PDF-1.7')
})

test('PDF tools validate ZIP and JSON result types independently', async () => {
  for (const [operation, fields, mime, content] of [
    ['split', { splitMode: 'pages', splitSpan: '1' }, 'application/zip', 'PK\u0003\u0004'],
    ['metadata-read', {}, 'application/json', '{}'],
  ] as const) {
    const form = new FormData()
    form.set('payload', JSON.stringify({ operation, fields, advanced: {} }))
    form.append('files', new File(['%PDF-1.7'], 'source.pdf', { type: 'application/pdf' }))
    const request = new Request(`${origin}/api/gotenberg/convert`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenberg-Url': backend },
      body: form,
    })
    const response = await proxyConversionRequest(
      request,
      async () => new Response(content, { headers: { 'Content-Type': mime } }),
    )
    assert.equal(response.status, 200, operation)
    assert.equal(await response.text(), content)
  }
})

test('body larger than the stream limit rejects the download and cancels upstream', async () => {
  vi.stubEnv('GOTENUI_MAX_RESPONSE_BYTES', '1024')
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const first = new Uint8Array(800)
      first.set(new TextEncoder().encode('%PDF-1.7'))
      controller.enqueue(first)
      controller.enqueue(new Uint8Array(300))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = await proxyConversionRequest(
    requestFor(),
    async () => new Response(stream, { headers: { 'Content-Type': 'application/pdf' } }),
  )
  assert.equal(response.status, 200)
  await assert.rejects(response.arrayBuffer(), /size limit/)
  assert.equal(cancelled, true)
})

test('unexpected early EOF rejects a declared-length conversion instead of downloading a truncated file', async () => {
  const response = await proxyConversionRequest(requestFor(), async () =>
    pdfResponse('%PDF-1.7', { 'Content-Length': '12' }),
  )
  await assert.rejects(response.text(), /truncated conversion response/)
})

test('exact-length responses succeed without buffering in the proxy', async () => {
  const response = await proxyConversionRequest(requestFor(), async () =>
    pdfResponse('%PDF-1.7', { 'Content-Length': '8' }),
  )
  assert.equal(await response.text(), '%PDF-1.7')
  assert.equal(response.headers.has('content-length'), false)
})

test('cancelling a streamed client response also cancels the upstream reader', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('%PDF-1.7'))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = await proxyConversionRequest(
    requestFor(),
    async () => new Response(stream, { headers: { 'Content-Type': 'application/pdf' } }),
  )
  const reader = response.body?.getReader()
  assert.ok(reader)
  assert.equal((await reader.read()).done, false)
  await reader.cancel()
  assert.equal(cancelled, true)
})

test('connection selections are isolated even when conversions overlap', async () => {
  vi.stubEnv(
    'GOTENUI_SERVER_CONNECTIONS',
    JSON.stringify([
      {
        id: 'private',
        name: 'Private server',
        url: backend,
        auth: { type: 'bearer', token: 'private-token' },
      },
    ]),
  )
  const started: string[] = []
  let completePrivate: (() => void) | undefined
  const blockPrivate = new Promise<void>((resolve) => {
    completePrivate = resolve
  })
  const fetcher: typeof fetch = async (_url, options) => {
    const authorization = new Headers(options?.headers).get('authorization') ?? 'public'
    started.push(authorization)
    if (authorization !== 'public') await blockPrivate
    return pdfResponse()
  }
  const privateRequest = requestFor(
    'url-pdf',
    { url: 'https://example.test' },
    {
      'X-Gotenui-Connection-Id': 'private',
    },
  )
  privateRequest.headers.delete('X-Gotenberg-Url')
  const pendingPrivate = proxyConversionRequest(privateRequest, fetcher)
  // First call resolves the server profile before yielding to the fetcher.
  const publicResponse = await proxyConversionRequest(requestFor(), fetcher)
  assert.equal(await publicResponse.text(), '%PDF-1.7')
  assert.deepEqual(new Set(started), new Set(['Bearer private-token', 'public']))
  completePrivate?.()
  const privateResponse = await pendingPrivate
  assert.equal(await privateResponse.text(), '%PDF-1.7')
})

test('abort and timeout errors report gateway statuses without upstream details', () => {
  for (const type of ['AbortError', 'TimeoutError']) {
    const response = proxyErrorResponse(new DOMException('sensitive request information', type))
    assert.equal(response.status, 504)
    assert.doesNotMatch(response.statusText, /sensitive/)
  }
  const other = proxyErrorResponse(new Error('Authorization: Bearer secret'))
  assert.equal(other.status, 502)
  assert.doesNotMatch(other.statusText, /secret/)
})
