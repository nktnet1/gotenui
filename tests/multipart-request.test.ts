import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { parseMultipartRequest } from '#/lib/multipart-request.server'
import { proxyConversionRequest } from './helpers/proxy-v8-fixture'

const boundary = 'payload-boundary'
const contentType = `multipart/form-data; boundary="${boundary}"`
const origin = 'https://app.example.test'
const backend = 'http://127.0.0.1:3000'
const payload = JSON.stringify({ operation: 'office-pdf', fields: {}, advanced: {} })
const textHeader = 'Content-Disposition: form-data; name="payload"'
const fileHeader = 'Content-Disposition: form-data; name="files"; filename="report.docx"'

function multipart(parts: readonly (readonly [string | Buffer, string | Buffer])[], preamble = '') {
  return Buffer.concat([
    Buffer.from(preamble),
    ...parts.flatMap(([headers, body]) => [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(headers),
      Buffer.from('\r\n\r\n'),
      Buffer.from(body),
      Buffer.from('\r\n'),
    ]),
    Buffer.from(`--${boundary}--\r\n`),
  ])
}

function request(bytes: Uint8Array<ArrayBuffer>) {
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend, 'Content-Type': contentType },
    body: bytes,
  })
}

beforeEach(() => vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend))
afterEach(() => vi.unstubAllEnvs())

test('multipart parsing preserves literal boundary tokens and binary contents', async () => {
  const source = `<p>${boundary} \r\n--${boundary}--not-a-delimiter</p>`
  const html = JSON.stringify({ operation: 'html-pdf', fields: {}, advanced: {}, source })
  const binary = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`\r\n--${boundary}--not-a-delimiter\r\n--${boundary}not-a-delimiter`),
  ])
  const input = multipart(
    [
      [textHeader, html],
      [fileHeader, binary],
    ],
    `preamble --${boundary} text\r\n`,
  )
  const fields = await parseMultipartRequest(input, boundary, contentType)
  assert.equal(fields.get('payload'), html)
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'report.docx')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
})

test('proxy forwards ordinary boundary substrings without changing valid uploaded bytes', async () => {
  const binary = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`\r\n--${boundary}--not-a-delimiter\r\n--${boundary}not-a-delimiter`),
  ])
  const response = await proxyConversionRequest(
    request(
      multipart([
        [textHeader, payload],
        [fileHeader, binary],
      ]),
    ),
    async (_, init) => {
      const form = init?.body
      assert.ok(form instanceof FormData)
      const file = form.get('files')
      assert.ok(file instanceof File)
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
      return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '%PDF-1.7')
})

test.each(['', 'Content-Transfer-Encoding: base64', ' Content-Transfer-Encoding: base64'])(
  'rejects malformed UTF-8 in multipart payload text (transfer encoding=%j)',
  async (transferEncoding) => {
    const raw = Buffer.concat([
      Buffer.from(`${payload.slice(0, -1)},"outputName":"report`),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ])
    const header = transferEncoding ? `${textHeader}\r\n${transferEncoding}` : textHeader
    const bytes = multipart([
      [header, transferEncoding ? raw.toString('base64') : raw],
      [fileHeader, 'file'],
    ])
    await assert.rejects(
      proxyConversionRequest(request(bytes), async () => {
        throw new Error('must not forward')
      }),
      { status: 400, message: /valid UTF-8/ },
    )
  },
)

test('rejects malformed UTF-8 in ordinary multipart filenames before proxying', async () => {
  const rawHeader = Buffer.concat([
    Buffer.from(fileHeader.replace('report.docx"', 'report')),
    Buffer.from([0xff]),
    Buffer.from('.docx"'),
  ])
  const bytes = multipart([
    [textHeader, payload],
    [rawHeader, 'file'],
  ])
  await assert.rejects(
    proxyConversionRequest(request(bytes), async () => {
      throw new Error('must not forward')
    }),
    { status: 400, message: /valid UTF-8/ },
  )
})

test('accepts intentional replacement characters and valid Unicode in text and filenames', async () => {
  const value = JSON.stringify({
    operation: 'office-pdf',
    fields: {},
    advanced: {},
    outputName: 'report�日本',
  })
  const fields = await parseMultipartRequest(
    multipart([
      [`${textHeader}\r\nContent-Transfer-Encoding: base64`, Buffer.from(value).toString('base64')],
      [fileHeader.replace('report.docx', 'report�日本.docx'), Buffer.from([0xff])],
    ]),
    boundary,
    contentType,
  )
  assert.equal(fields.get('payload'), value)
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'report�日本.docx')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([0xff]))
})

test('rejects an upload with no complete closing delimiter', async () => {
  const bytes = multipart([[textHeader, payload]])
  await assert.rejects(
    parseMultipartRequest(bytes.subarray(0, bytes.length - 5), boundary, contentType),
    { status: 400 },
  )
})
