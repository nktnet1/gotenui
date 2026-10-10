import assert from 'node:assert/strict'
import { crc32, inflateSync } from 'node:zlib'
import { test } from 'vitest'
import { REMOTE_OVERLAY_PNG } from './integration/overlay-fixture'

test('remote overlay fixture is a decodable RGB PNG with valid chunk checksums', () => {
  const png = REMOTE_OVERLAY_PNG
  assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))

  let offset = 8
  let width = 0
  let height = 0
  let foundEnd = false
  const imageData: Buffer[] = []
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'Truncated PNG chunk header')
    const length = png.readUInt32BE(offset)
    const chunkEnd = offset + length + 12
    assert.ok(chunkEnd <= png.length, 'Truncated PNG chunk data')

    const name = png.toString('ascii', offset + 4, offset + 8)
    const chunk = png.subarray(offset + 8, offset + 8 + length)
    assert.equal(
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      png.readUInt32BE(offset + 8 + length),
      `${name} has an invalid PNG CRC`,
    )
    if (name === 'IHDR') {
      assert.equal(length, 13)
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      assert.equal(chunk[8], 8, 'Expected 8-bit pixels')
      assert.equal(chunk[9], 2, 'Expected RGB pixels')
    }
    if (name === 'IDAT') imageData.push(chunk)
    if (name === 'IEND') {
      foundEnd = true
      assert.equal(chunkEnd, png.length)
    }
    offset = chunkEnd
  }

  assert.equal(foundEnd, true, 'Missing PNG end chunk')
  assert.equal(width, 32)
  assert.equal(height, 32)
  assert.ok(imageData.length > 0, 'Missing PNG pixel data')
  assert.equal(inflateSync(Buffer.concat(imageData)).byteLength, height * (width * 3 + 1))
})
