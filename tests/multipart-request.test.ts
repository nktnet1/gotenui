import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { conversionRequestBody } from '#/lib/conversion-request-body'
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

function request(bytes: Uint8Array<ArrayBuffer>, type = contentType) {
  return new Request(`${origin}/api/gotenberg/convert`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Gotenberg-Url': backend, 'Content-Type': type },
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
  const fields = await parseMultipartRequest(input, boundary)
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

test.each([
  '',
  'Content-Transfer-Encoding: base64',
  ' Content-Transfer-Encoding: base64',
  'Content-Transfer-Encoding: BASE64',
  'Content-Transfer-Encoding: Base64 \t',
])(
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
  )
  assert.equal(fields.get('payload'), value)
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'report�日本.docx')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([0xff]))
})

test('rejects an upload with no complete closing delimiter', async () => {
  const bytes = multipart([[textHeader, payload]])
  await assert.rejects(parseMultipartRequest(bytes.subarray(0, bytes.length - 5), boundary), {
    status: 400,
  })
})

test('decodes language-tagged UTF-8 disposition filenames without corrupting the name', async () => {
  const binary = Buffer.from([0xff, 0x00, 0x80])
  for (const tag of ['', 'en-US', 'ja']) {
    const fields = await parseMultipartRequest(
      multipart([
        [textHeader, payload],
        [
          `Content-Disposition: form-data; name="files"; filename*=UTF-8'${tag}'r%C3%A9sum%C3%A9.docx`,
          binary,
        ],
      ]),
      boundary,
    )
    const file = fields.get('files')
    assert.ok(file instanceof File)
    assert.equal(file.name, 'r\u00e9sum\u00e9.docx')
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
  }
})

test.each(['%FF.docx', '%C0%AF.docx', '%ZZ.docx', '%ED%A0%80.docx'])(
  'rejects invalid extended filename bytes: %s',
  async (encoded) => {
    await assert.rejects(
      parseMultipartRequest(
        multipart([
          [textHeader, payload],
          [
            `Content-Disposition: form-data; name="files"; filename*=UTF-8'en'${encoded}`,
            'document',
          ],
        ]),
        boundary,
      ),
      { status: 400, message: /Invalid extended multipart disposition/ },
    )
  },
)

test('ignores MIME delimiter padding and preserves similar lines inside the document', async () => {
  const binary = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(`\r\n--${boundary} \tnot-a-delimiter`),
  ])
  const bytes = Buffer.concat([
    Buffer.from(
      `preamble\r\n--${boundary} \t\r\n${textHeader}\r\n\r\n${payload}\r\n--${boundary}\t\r\n${fileHeader}\r\n\r\n`,
    ),
    binary,
    Buffer.from(`\r\n--${boundary}-- \t\r\nepilogue`),
  ])
  const fields = await parseMultipartRequest(bytes, boundary)
  assert.equal(fields.get('payload'), payload)
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
})

test.each(['\u2028', '\u2029'])(
  'does not interpret Unicode separators in unrelated headers as MIME header breaks',
  async (separator) => {
    const header = `${textHeader}\r\nX-Other: value${separator}Content-Transfer-Encoding: base64`
    await assert.rejects(
      parseMultipartRequest(multipart([[header, Buffer.from([0xff])]]), boundary),
      { status: 400, message: /valid UTF-8/ },
    )
  },
)

test('preserves leading BOM characters in ordinary names without changing extended precedence', async () => {
  const fields = await parseMultipartRequest(
    multipart([
      [textHeader.replace('payload', '\uFEFFpayload'), payload],
      [fileHeader.replace('report.docx', '\uFEFF\uFEFFreport.docx'), 'one'],
      [
        `${fileHeader.replace('report.docx', '\uFEFFreport.docx')}; filename*=UTF-8'en'resume.docx`,
        'two',
      ],
      [
        `${fileHeader.replace('report.docx', '\uFEFFreport.docx')}; other="; filename=\uFEFFignored"`,
        'three',
      ],
    ]),
    boundary,
  )
  assert.equal(fields.get('\uFEFFpayload'), payload)
  assert.equal(fields.has('payload'), false)
  const files = fields.getAll('files')
  assert.deepEqual(
    files.map((file) => (file instanceof File ? file.name : file)),
    ['\uFEFF\uFEFFreport.docx', 'resume.docx', '\uFEFFreport.docx'],
  )
})

test.each(['base64', 'Base64', 'BASE64 \t'])(
  'decodes MIME transfer encoding %j in text and binary parts',
  async (encoding) => {
    const value = 'report \uFEFF日本'
    const binary = Buffer.from([0xff, 0, 0x81])
    const fields = await parseMultipartRequest(
      multipart([
        [
          `${textHeader}\r\nContent-Transfer-Encoding: ${encoding}`,
          Buffer.from(value).toString('base64'),
        ],
        [`${fileHeader}\r\nContent-Transfer-Encoding: ${encoding}`, binary.toString('base64')],
      ]),
      boundary,
    )
    assert.equal(fields.get('payload'), value)
    const file = fields.get('files')
    assert.ok(file instanceof File)
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
  },
)

test('accepts a quoted multipart boundary containing an internal space', async () => {
  const spaced = 'payload boundary'
  const bytes = Buffer.from(
    multipart([
      [textHeader, payload],
      [fileHeader, 'document'],
    ])
      .toString()
      .replaceAll(boundary, spaced),
  )
  const response = await proxyConversionRequest(
    request(bytes, `multipart/form-data; boundary="${spaced}"`),
    async (_, init) => {
      const form = init?.body
      assert.ok(form instanceof FormData)
      const file = form.get('files')
      assert.ok(file instanceof File)
      assert.equal(await file.text(), 'document')
      return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(response.status, 200)
})

test.each([
  'form-data ; name = "files" ; filename = "report.pdf"',
  'form-data; name="files"; filename*=UTF-8\'en\'report.pdf\t; other=one',
  'form-data; name="files"; filename*=UTF-8\'\'report.pdf\t',
])('preserves valid MIME disposition parameter whitespace (%s)', async (disposition) => {
  const binary = Buffer.from([0xff, 0x00])
  const fields = await parseMultipartRequest(
    multipart([[`Content-Disposition: ${disposition}`, binary]]),
    boundary,
  )
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'report.pdf')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), binary)
})

test('does not change literal punctuation, escapes or whitespace inside quoted filename values', async () => {
  const name = '\uFEFFreport ; name = x%22.pdf '
  const fields = await parseMultipartRequest(
    multipart([[fileHeader.replace('report.docx', name), 'document']]),
    boundary,
  )
  const file = fields.get('files')
  assert.ok(file instanceof File)
  assert.equal(file.name, name.replace('%22', '"'))
})

test.each(['eH!l6', 'eHl', 'eA==eQ==', 'eH_l', 'eH\u00a0l6', '=eHl', 'eHl6===='])(
  'rejects malformed Base64 in text and uploaded binary parts: %j',
  async (body) => {
    for (const disposition of [textHeader, fileHeader]) {
      await assert.rejects(
        parseMultipartRequest(
          multipart([[`${disposition}\r\nContent-Transfer-Encoding: base64`, body]]),
          boundary,
        ),
        { status: 400, message: /Base64 transfer encoding is invalid/ },
      )
    }
  },
)

test.each(['quoted-printable', 'unknown', 'base64\u2028', ''])(
  'rejects unsupported multipart transfer encoding %j',
  async (encoding) => {
    await assert.rejects(
      parseMultipartRequest(
        multipart([[`${fileHeader}\r\nContent-Transfer-Encoding: ${encoding}`, 'eHl6']]),
        boundary,
      ),
      { status: 400, message: /Unsupported multipart Content-Transfer-Encoding/ },
    )
  },
)

test('rejects duplicate transfer encodings rather than relying on native last-header precedence', async () => {
  await assert.rejects(
    parseMultipartRequest(
      multipart([
        [
          `${fileHeader}\r\nContent-Transfer-Encoding: base64\r\nContent-Transfer-Encoding: binary`,
          'eHl6',
        ],
      ]),
      boundary,
    ),
    { status: 400, message: /must not repeat Content-Transfer-Encoding/ },
  )
})

test('accepts wrapped padded Base64 and identity transfer encodings without changing file contents', async () => {
  const binary = Buffer.from([0xff, 0, 0x80, 1, 2])
  const encoded = binary.toString('base64')
  const fields = await parseMultipartRequest(
    multipart([
      [`${textHeader}\r\nContent-Transfer-Encoding: base64`, 'eH\r\n l6'],
      [
        `${fileHeader}\r\nContent-Transfer-Encoding: BASE64`,
        `${encoded.slice(0, 4)}\r\n\t${encoded.slice(4)}`,
      ],
      [`${fileHeader}\r\nContent-Transfer-Encoding: binary`, binary],
      [`${fileHeader}\r\nContent-Transfer-Encoding: 8BIT`, binary],
      [`${fileHeader}\r\nContent-Transfer-Encoding: 7bit`, 'plain ASCII'],
    ]),
    boundary,
  )
  assert.equal(fields.get('payload'), 'xyz')
  const files = fields.getAll('files')
  assert.equal(files.length, 4)
  for (const [index, file] of files.entries()) {
    assert.ok(file instanceof File)
    assert.deepEqual(
      Buffer.from(await file.arrayBuffer()),
      index === 3 ? Buffer.from('plain ASCII') : binary,
    )
  }
})

test('proxy retains repeated overlay files in their configured order', async () => {
  const settings = JSON.stringify({
    operation: 'office-pdf',
    fields: {},
    advanced: {},
    postProcess: {
      watermarks: [
        { source: 'image', expression: 'first.png' },
        { source: 'image', expression: 'second.png' },
      ],
      stamps: [
        { source: 'image', expression: 'third.png' },
        { source: 'image', expression: 'fourth.png' },
      ],
    },
  })
  const response = await proxyConversionRequest(
    request(
      multipart([
        [textHeader, settings],
        [fileHeader, 'source'],
        ...['first', 'second', 'third', 'fourth'].map(
          (name, index) =>
            [
              `Content-Disposition: form-data; name="${index < 2 ? 'watermark' : 'stamp'}"; filename="${name}.png"\r\nContent-Type: image/png`,
              name,
            ] as const,
        ),
      ]),
    ),
    async (_, init) => {
      const form = init?.body
      assert.ok(form instanceof FormData)
      for (const [kind, names] of [
        ['watermark', ['first', 'second']],
        ['stamp', ['third', 'fourth']],
      ] as const) {
        const files = form.getAll(kind)
        assert.equal(files.length, names.length)
        for (const [index, file] of files.entries()) {
          assert.ok(file instanceof File)
          assert.equal(file.name, `${names[index]}.png`)
          assert.equal(await file.text(), names[index])
        }
      }
      return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(response.status, 200)
})

test('decodes MIME-escaped quote and special pairs without treating quoted text as parameters', async () => {
  const fields = await parseMultipartRequest(
    multipart([
      [
        String.raw`Content-Disposition: form-data; name="files"; filename="r\"e\;port.docx"`,
        'first',
      ],
      [
        String.raw`Content-Disposition: form-data; name="files"; filename="safe.docx"; other="fake\"; filename=wrong.docx"`,
        'second',
      ],
      [
        String.raw`Content-Disposition: form-data; name="files"; filename="C:\folder\report.docx"`,
        'third',
      ],
    ]),
    boundary,
  )
  assert.deepEqual(
    fields.getAll('files').map((entry) => (entry instanceof File ? entry.name : entry)),
    ['r"e;port.docx', 'safe.docx', String.raw`C:\folder\report.docx`],
  )
})

test.each([
  `multipart/form-data; boundary = "${boundary}"`,
  `multipart/form-data; boundary= "${boundary}"`,
  `multipart/form-data ; charset = UTF-8 ; boundary = "${boundary}"`,
  `Multipart/Form-Data; Boundary = ${boundary}; Charset = "utf-8"`,
])('accepts validated MIME media-type parameter whitespace: %s', async (type) => {
  const response = await proxyConversionRequest(
    request(
      multipart([
        [textHeader, payload],
        [fileHeader, 'document'],
      ]),
      type,
    ),
    async (_, init) => {
      const form = init?.body
      assert.ok(form instanceof FormData)
      const file = form.get('files')
      assert.ok(file instanceof File)
      assert.equal(file.name, 'report.docx')
      assert.equal(await file.text(), 'document')
      return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
    },
  )
  assert.equal(response.status, 200)
})

test.each([
  [
    `${fileHeader}\r\ncontent-disposition: form-data; name="stageFile"; filename="other.docx"`,
    'content-disposition',
  ],
  [`${fileHeader}\r\nContent-Type: application/pdf\r\ncontent-type: text/plain`, 'content-type'],
  [`${fileHeader}; Name = "stageFile"`, 'name'],
  [`${fileHeader}; Filename = "other.docx"`, 'filename'],
  [`${fileHeader}; name*=UTF-8''stageFile`, 'name'],
  [`${fileHeader}; filename*=UTF-8''one.docx; FILENAME*=UTF-8''two.docx`, 'filename*'],
])('rejects ambiguous multipart part headers and parameters: %s', async (header, parameter) => {
  await assert.rejects(parseMultipartRequest(multipart([[header, 'document']]), boundary), {
    status: 400,
    message: `Multipart ${parameter.startsWith('content-') ? 'parts' : 'disposition'} must not repeat ${parameter}.`,
  })
})

test('preserves a valid ordinary filename fallback regardless of extended parameter order', async () => {
  const fields = await parseMultipartRequest(
    multipart([
      [
        `Content-Disposition: form-data; name="files"; filename*=UTF-8'en'report.docx; filename="fallback.docx"`,
        'first',
      ],
      [
        `Content-Disposition: form-data; name="files"; filename="fallback.docx"; filename*=UTF-8'en'report.docx`,
        'second',
      ],
    ]),
    boundary,
  )
  assert.deepEqual(
    fields.getAll('files').map((entry) => (entry instanceof File ? entry.name : entry)),
    ['report.docx', 'report.docx'],
  )
})

test.each([
  `multipart/form-data\u00a0; boundary=${boundary}`,
  `multipart/form-data; \u00a0boundary=${boundary}`,
  `multipart/form-data; boundary=\u00a0${boundary}`,
  `multipart/form-data; boundary=${boundary}\u00a0`,
])('rejects non-ASCII media-type whitespace instead of silently repairing it: %s', async (type) => {
  await assert.rejects(
    proxyConversionRequest(
      request(
        multipart([
          [textHeader, payload],
          [fileHeader, 'document'],
        ]),
        type,
      ),
      async () => {
        throw new Error('must not forward')
      },
    ),
    { status: 400, message: /Expected a multipart\/form-data/ },
  )
})

// Exercise the same envelope used by browser, batch and integration requests.
test.each(['document.docx', 'document %22.docx'])(
  'conversion request body preserves every upload group and its order (%s)',
  async (filename) => {
    const candidate = {
      operation: 'office-pdf',
      expectedBackendVersion: '9.10.0',
      fields: { merge: false },
      advanced: {},
    }
    const file = (name: string) => new File([new Uint8Array([0, 255, 13, 10])], name)
    const source = file(filename)
    const auxiliary = file('style.css')
    const stage = file('stage.pdf')
    const archive = file('source.zip')
    const watermarks = [file('watermark-1.png'), file('watermark-2.png')]
    const stamp = file('stamp.png')
    const embed = file('embed.txt')
    const facturxXml = file('invoice.xml')
    const body = conversionRequestBody(
      candidate,
      [source],
      [auxiliary],
      { watermark: watermarks, stamp, embeds: [embed], facturxXml },
      [stage],
      [archive],
    )
    const decoded = await new Response(body).formData()
    assert.deepEqual(JSON.parse(String(decoded.get('payload'))), candidate)
    const expected: [string, File][] = [
      ['files', source],
      ['auxiliary', auxiliary],
      ['stageFile', stage],
      ['archives', archive],
      ...watermarks.map((upload): [string, File] => ['watermark', upload]),
      ['stamp', stamp],
      ['embeds', embed],
      ['facturxXml', facturxXml],
    ]
    assert.deepEqual([...decoded.keys()], ['payload', ...expected.map(([key]) => key)])
    for (const [index, [key, upload]] of expected.entries()) {
      const entry = [...decoded.entries()][index + 1]
      assert.equal(entry?.[0], key)
      assert.ok(entry[1] instanceof File)
      assert.equal(entry[1].name, upload.name)
      assert.deepEqual(await entry[1].arrayBuffer(), await upload.arrayBuffer())
    }
  },
)
