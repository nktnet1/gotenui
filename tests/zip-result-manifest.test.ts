import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { ZipResultPreview } from '#/components/zip-result-preview'
import { inspectZipResult } from '#/lib/zip-result-manifest'

/** Stored ZIP fixture with a real central directory, not just a PK prefix. */
function zipFixture(names: string[], comment = '', firstFileBytes?: number): Uint8Array {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [index, name] of names.entries()) {
    const filename = new TextEncoder().encode(name)
    const content =
      index === 0 && firstFileBytes !== undefined
        ? new Uint8Array(firstFileBytes)
        : new TextEncoder().encode(`content for ${name}`)
    const local = new Uint8Array(30 + filename.length + content.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint32(18, content.length, true)
    localView.setUint32(22, content.length, true)
    localView.setUint16(26, filename.length, true)
    local.set(filename, 30)
    local.set(content, 30 + filename.length)
    const directory = new Uint8Array(46 + filename.length)
    const view = new DataView(directory.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint32(24, content.length, true)
    view.setUint16(28, filename.length, true)
    view.setUint32(42, offset, true)
    directory.set(filename, 46)
    locals.push(local)
    central.push(directory)
    offset += local.length
  }
  const commentBytes = new TextEncoder().encode(comment)
  const footer = new Uint8Array(22 + commentBytes.length)
  const end = new DataView(footer.buffer)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, names.length, true)
  end.setUint16(10, names.length, true)
  end.setUint32(
    12,
    central.reduce((sum, item) => sum + item.length, 0),
    true,
  )
  end.setUint32(16, offset, true)
  end.setUint16(20, commentBytes.length, true)
  footer.set(commentBytes, 22)
  const result = new Uint8Array(
    [...locals, ...central, footer].reduce((sum, item) => sum + item.length, 0),
  )
  let position = 0
  for (const item of [...locals, ...central, footer]) {
    result.set(item, position)
    position += item.length
  }
  return result
}

function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)])
}

test('previews PDF and rendered image entries from a commented ZIP without extracting bytes', async () => {
  const archive = zipBlob(zipFixture(['converted.pdf', 'page-1.png', 'notes.txt'], 'my comment'))
  const result = await inspectZipResult(archive)
  assert.deepEqual(
    result.entries.map(({ id: _id, ...entry }) => entry),
    [
      { name: 'converted.pdf', kind: 'PDF', size: 'content for converted.pdf'.length },
      { name: 'page-1.png', kind: 'Image', size: 'content for page-1.png'.length },
      { name: 'notes.txt', kind: 'Other', size: 'content for notes.txt'.length },
    ],
  )
  assert.deepEqual(
    { totalFiles: result.totalFiles, totalUncompressedBytes: result.totalUncompressedBytes },
    {
      totalFiles: 3,
      totalUncompressedBytes:
        'content for converted.pdf'.length +
        'content for page-1.png'.length +
        'content for notes.txt'.length,
    },
  )
})

test('classifies a multi-page render archive as images, not PDFs', async () => {
  const result = await inspectZipResult(zipBlob(zipFixture(['page-1.png', 'page-2.png'])))
  assert.equal(result.totalFiles, 2)
  assert.deepEqual(
    result.entries.map(({ kind }) => kind),
    ['Image', 'Image'],
  )
})

test('bounds the visible list and excludes directory entries', async () => {
  const archive = zipBlob(
    zipFixture(['photos/', ...Array.from({ length: 35 }, (_, i) => `page-${i}.png`)]),
  )
  const manifest = await inspectZipResult(archive)
  assert.equal(manifest.totalFiles, 35)
  assert.equal(manifest.entries.length, 30)
  assert.equal(manifest.entries[0]?.name, 'page-0.png')
})

test('reads only the directory and footer, not a complete large archive', async () => {
  const bytes = zipFixture(['file.pdf'], '', 2_000_000)
  const blob = zipBlob(bytes)
  assert.ok(blob.size > 2_000_000)
  const slices: number[] = []
  const original = blob.slice.bind(blob)
  blob.slice = (start?: number, end?: number, type?: string) => {
    slices.push((end ?? blob.size) - (start ?? 0))
    return original(start, end, type)
  }
  await inspectZipResult(blob)
  assert.equal(slices.length, 2)
  assert.ok(slices.every((length) => length <= 65_557))
})

test('a malformed ZIP, incomplete index, or unsupported ZIP64 entry does not invent contents', async () => {
  await assert.rejects(inspectZipResult(new Blob(['PK\u0003\u0004'])), /directory is missing/)
  const truncated = zipFixture(['file.pdf'])
  truncated[truncated.length - 6] = 0xff // Corrupt central-directory offset.
  await assert.rejects(
    inspectZipResult(zipBlob(truncated)),
    /unsupported format|Invalid|incomplete/,
  )
  const zip64 = zipFixture(['file.pdf'])
  const end = zip64.length - 22
  new DataView(zip64.buffer).setUint32(end + 12, 0xffffffff, true)
  await assert.rejects(inspectZipResult(zipBlob(zip64)), /unsupported format/)
})

test('the ZIP preview is opt-in and does not unpack or display files on initial render', () => {
  const html = renderToStaticMarkup(createElement(ZipResultPreview, { blob: new Blob(['PK']) }))
  assert.match(html, /View archive contents/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /Archive files|Reading ZIP directory/)
})
