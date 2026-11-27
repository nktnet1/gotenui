import { afterAll, beforeAll, expect, inject, test, vi } from 'vitest'
import { conversionRequestBody } from '#/lib/conversion-request-body'
import { proxyConversionRequest, proxyStatusRequest } from '#/lib/gotenberg-proxy.server'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'

const origin = 'http://gotenui.test'
const backend = inject('gotenbergTestUrl')
const version = inject('gotenbergTestVersion')
const parsed = parseGotenbergVersion(version)
if (!parsed) throw new Error(`Invalid integration version ${version}`)
const fixture = inject('gotenbergFixtureUrl')

beforeAll(async () => {
  vi.stubEnv('GOTENBERG_ALLOWED_URLS', backend)
  vi.stubEnv('GOTENUI_SERVER_CONNECTIONS', undefined)
  vi.stubEnv('GOTENBERG_BASIC_AUTH_URL', backend)
  vi.stubEnv('GOTENBERG_BASIC_AUTH_USERNAME', inject('gotenbergTestUsername'))
  vi.stubEnv('GOTENBERG_BASIC_AUTH_PASSWORD', inject('gotenbergTestPassword'))
  const response = await proxyStatusRequest(
    new Request(`${origin}/api/gotenberg/status?connection=legacy-basic`),
  )
  expect(response.status).toBe(200)
  const status = await response.json()
  expect(status.online).toBe(true)
  expect(parseGotenbergVersion(status.version)).toEqual(parsed)
})
afterAll(() => vi.unstubAllEnvs())

async function convert(
  id: string,
  fields: Record<string, string | boolean> = {},
  files: File[] = [],
) {
  const operation = OPERATION_BY_ID.get(id)
  if (!operation) throw new Error(`Missing operation ${id}`)
  const body = conversionRequestBody(
    {
      operation: id,
      fields: { ...operationDefaults(operation), ...fields },
      advanced: {},
      ...(operation.input === 'html'
        ? { source: '<!doctype html><html><body><h1>Compatibility fixture</h1></body></html>' }
        : {}),
    },
    files,
  )
  return proxyConversionRequest(
    new Request(`${origin}/api/gotenberg/convert`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Gotenui-Connection-Id': 'legacy-basic' },
      body,
    }),
  )
}

async function expectPdf(response: Response) {
  if (!response.ok)
    throw new Error(`PDF conversion on ${version}: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('application/pdf')
  expect(
    new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).subarray(0, 5)),
  ).toBe('%PDF-')
}

test('HTML conversion works through the authenticated adapter', async () => {
  await expectPdf(await convert('html-pdf'))
})

test('HTTP error checks distinguish server defaults from an explicit empty array', async () => {
  const url = new URL('/status/404', fixture).href
  const failed = await convert('url-pdf', { url })
  expect(failed.status).toBe(409)
  await expectPdf(
    await convert('url-pdf', {
      url,
      failOnHttpStatusCodes: '[]',
      failOnResourceHttpStatusCodes: '[]',
    }),
  )
})

test('default screenshot viewport matches the upstream default', async () => {
  const response = await convert('html-shot', {
    clip: true,
    emulatedMediaType: 'screen',
    mediaColorScheme: 'dark',
  })
  if (!response.ok)
    throw new Error(`Screenshot on ${version}: ${response.status} ${await response.text()}`)
  expect(response.headers.get('content-type')).toContain('image/png')
  const bytes = new DataView(await response.arrayBuffer())
  expect(bytes.getUint32(16)).toBe(800)
  expect(bytes.getUint32(20)).toBe(600)
})

test('LibreOffice locale is accepted at its introduction and rejected on older releases', async () => {
  const execute = () =>
    convert('office-pdf', { locale: 'en-AU' }, [new File(['Compatibility fixture'], 'source.txt')])
  if (parsed.major === 9 && parsed.minor >= 9) await expectPdf(await execute())
  else await expect(execute()).rejects.toThrow(/9\.9/)
})

test('tracked-change options respect the 9.10 boundary', async () => {
  const execute = () =>
    convert('office-pdf', { showTrackedChanges: true }, [
      new File(['Compatibility fixture'], 'source.txt'),
    ])
  if (parsed.major === 9 && parsed.minor >= 10) await expectPdf(await execute())
  else await expect(execute()).rejects.toThrow(/9\.10/)
})

test.skipIf(parsed.major !== 9)('large paper sizes respect the 9.5 boundary', async () => {
  const execute = () => convert('html-pdf', { paperSize: 'A2' })
  if (parsed.minor >= 5) await expectPdf(await execute())
  else await expect(execute()).rejects.toThrow(/9\.5/)
})

test.skipIf(parsed.major !== 8)('console checks respect the v8.39 boundary', async () => {
  const execute = () => convert('html-pdf', { failOnConsoleMessageTypes: '["error"]' })
  if (parsed.minor >= 39) await expectPdf(await execute())
  else await expect(execute()).rejects.toThrow(/8\.39/)
})

test.skipIf(parsed.major !== 8)('Office tagging respects the v8.38 boundary', async () => {
  const execute = () =>
    convert('office-pdf', { generateTaggedPdf: true }, [
      new File(['Compatibility fixture'], 'source.txt'),
    ])
  if (parsed.minor >= 38) await expectPdf(await execute())
  else await expect(execute()).rejects.toThrow(/8\.38/)
})
