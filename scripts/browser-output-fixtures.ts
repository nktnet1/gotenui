/** An actual PNG and a two-image stored ZIP for exercising UI downloads without Docker. */
export const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8X8f4n4GBgYGJAQoAJwYCgQHcx2sAAAAASUVORK5CYII=',
  'base64',
)

export function browserImageZip(): Uint8Array {
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const name of ['page-1.png', 'page-2.png']) {
    const filename = new TextEncoder().encode(name)
    let checksum = 0xffffffff
    for (const byte of samplePng) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++) {
        checksum = checksum & 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1
      }
    }
    const crc = (checksum ^ 0xffffffff) >>> 0
    const local = new Uint8Array(30 + filename.length + samplePng.length)
    const fileView = new DataView(local.buffer)
    fileView.setUint32(0, 0x04034b50, true)
    fileView.setUint16(4, 20, true)
    fileView.setUint32(14, crc, true)
    fileView.setUint32(18, samplePng.length, true)
    fileView.setUint32(22, samplePng.length, true)
    fileView.setUint16(26, filename.length, true)
    local.set(filename, 30)
    local.set(samplePng, 30 + filename.length)
    parts.push(local)

    const central = new Uint8Array(46 + filename.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, samplePng.length, true)
    centralView.setUint32(24, samplePng.length, true)
    centralView.setUint16(28, filename.length, true)
    centralView.setUint32(42, offset, true)
    central.set(filename, 46)
    directory.push(central)
    offset += local.length
  }
  const footer = new Uint8Array(22)
  const endView = new DataView(footer.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, directory.length, true)
  endView.setUint16(10, directory.length, true)
  endView.setUint32(
    12,
    directory.reduce((sum, part) => sum + part.length, 0),
    true,
  )
  endView.setUint32(16, offset, true)
  const chunks = [...parts, ...directory, footer]
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let cursor = 0
  for (const chunk of chunks) {
    result.set(chunk, cursor)
    cursor += chunk.length
  }
  return result
}
