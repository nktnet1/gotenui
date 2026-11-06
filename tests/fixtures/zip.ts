/** Minimal stored ZIP fixture with a valid central directory (and CRC-32).
 * Test helpers must not disguise a four-byte PK signature as a real ZIP.
 */
export function zipFixture(
  entries: Readonly<Record<string, string | Uint8Array>>,
  name = 'inputs.zip',
): File {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [filename, source] of Object.entries(entries)) {
    const label = new TextEncoder().encode(filename)
    const content = typeof source === 'string' ? new TextEncoder().encode(source) : source
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = new Uint8Array(30 + label.length + content.length)
    const lh = new DataView(local.buffer)
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, content.length, true)
    lh.setUint32(22, content.length, true)
    lh.setUint16(26, label.length, true)
    local.set(label, 30)
    local.set(content, 30 + label.length)
    locals.push(local)
    const dir = new Uint8Array(46 + label.length)
    const dh = new DataView(dir.buffer)
    dh.setUint32(0, 0x02014b50, true)
    dh.setUint16(4, 20, true)
    dh.setUint16(6, 20, true)
    dh.setUint32(16, crc, true)
    dh.setUint32(20, content.length, true)
    dh.setUint32(24, content.length, true)
    dh.setUint16(28, label.length, true)
    dh.setUint32(42, offset, true)
    dir.set(label, 46)
    central.push(dir)
    offset += local.length
  }
  const end = new Uint8Array(22)
  const footer = new DataView(end.buffer)
  footer.setUint32(0, 0x06054b50, true)
  footer.setUint16(8, central.length, true)
  footer.setUint16(10, central.length, true)
  footer.setUint32(
    12,
    central.reduce((total, dir) => total + dir.length, 0),
    true,
  )
  footer.setUint32(16, offset, true)
  const chunks = [...locals, ...central, end]
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let cursor = 0
  for (const chunk of chunks) {
    bytes.set(chunk, cursor)
    cursor += chunk.length
  }
  return new File([bytes], name, { type: 'application/zip' })
}
