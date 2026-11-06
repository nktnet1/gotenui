import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { parsePdfPipeline } from '#/lib/pdf-pipeline'
import { timestampAuthorityUrl } from '#/lib/timestamp-authority'

const parse = (value: string) =>
  parsePdfPipeline(JSON.stringify([{ op: 'timestamp', timestampUrl: value }]))

describe('timestamp authority URLs', () => {
  it('canonicalises standalone and pipeline URLs without dropping the query', () => {
    assert.equal(
      timestampAuthorityUrl('HTTPS://TSA.EXAMPLE.test:443/stamp?token=a%2Fb'),
      'https://tsa.example.test/stamp?token=a%2Fb',
    )
    assert.deepEqual(parse('HTTPS://TSA.EXAMPLE.test:443/stamp?token=a%2Fb'), [
      { op: 'timestamp', timestampUrl: 'https://tsa.example.test/stamp?token=a%2Fb' },
    ])
    assert.deepEqual(
      parsePdfPipeline(
        '[{"op":"sign","certificate":"test.p12","timestampUrl":"https://tsa.example.test"}]',
      ),
      [{ op: 'sign', certificate: 'test.p12', timestampUrl: 'https://tsa.example.test/' }],
    )
    assert.equal(timestampAuthorityUrl('http://127.0.0.1:9000/tsa'), 'http://127.0.0.1:9000/tsa')
  })

  it.each([
    '',
    ' https://tsa.example.test',
    'https://tsa.example.test ',
    'https://tsa.example.test\n',
    'https://tsa.example.test\\@evil.test',
    'https://user:secret@tsa.example.test',
    'https://tsa.example.test/path#fragment',
    'ftp://tsa.example.test',
    'file:///etc/passwd',
    'javascript:alert(1)',
    `https://tsa.example.test/${'a'.repeat(2000)}`,
  ])('rejects unsafe or ambiguous input: %s', (value) => {
    assert.throws(
      () => timestampAuthorityUrl(value),
      /timestamp authority URL|Timestamp authority URLs/,
    )
    assert.throws(
      () => parse(value),
      /timestamp authority URL|Timestamp authority URLs|non-empty string/,
    )
  })
})
