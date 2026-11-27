import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ConversionPayload } from '#/lib/validation'
import { validateZipInputs, zipEntryNames } from '#/lib/zip-input-validation'
import { inspectZipResult } from '#/lib/zip-result-manifest'
import { OPERATION_BY_ID } from '#/tools/registry'
import { zipFixture } from './fixtures/zip'

const payload: ConversionPayload = {
  operation: 'pdf-pipeline',
  fields: { stages: '[{"op":"merge"}]' },
  advanced: {},
}

async function check(
  operationId: string,
  archives: File[],
  options: {
    files?: File[]
    auxiliary?: File[]
    stageFiles?: File[]
    payload?: ConversionPayload
  } = {},
): Promise<string[]> {
  const operation = OPERATION_BY_ID.get(operationId)
  if (!operation) throw new Error(`Missing operation: ${operationId}`)
  return validateZipInputs(
    operation,
    options.payload ?? payload,
    options.files ?? [],
    options.auxiliary ?? [],
    options.stageFiles ?? [],
    archives,
  )
}

test('accepts ZIPs with a trailing stub after the end record or ZIP comment', async () => {
  const original = zipFixture({ 'input.pdf': '%PDF-1.7' })
  const trailer = new TextEncoder().encode('extra bytes after the end record')
  assert.deepEqual(await check('pdf-pipeline', [new File([original, trailer], 'appended.zip')]), [
    'input.pdf',
  ])
  const raw = new Uint8Array(await original.arrayBuffer())
  const comment = new TextEncoder().encode('some comment')
  const modified = new Uint8Array(raw.length + comment.length + trailer.length)
  modified.set(raw)
  new DataView(modified.buffer).setUint16(raw.length - 2, comment.length, true)
  modified.set(comment, raw.length)
  modified.set(trailer, raw.length + comment.length)
  assert.deepEqual(await check('pdf-pipeline', [new File([modified], 'comment.zip')]), [
    'input.pdf',
  ])
})

test('accepts a maximum ZIP comment followed by a short trailer', async () => {
  const original = new Uint8Array(await zipFixture({ 'input.pdf': '%PDF-1.7' }).arrayBuffer())
  const bytes = new Uint8Array(original.length + 65_535 + 512)
  bytes.set(original)
  new DataView(bytes.buffer).setUint16(original.length - 2, 65_535, true)
  bytes.fill(65, original.length)
  assert.deepEqual(await check('pdf-pipeline', [new File([bytes], 'comment.zip')]), ['input.pdf'])
  assert.equal((await inspectZipResult(new Blob([bytes]))).entries[0]?.name, 'input.pdf')
})

test('rejects a truncated newest end record instead of inspecting an older directory', async () => {
  const original = zipFixture({ 'input.pdf': '%PDF-1.7' })
  const truncated = new Uint8Array(22)
  const end = new DataView(truncated.buffer)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(20, 1024, true)
  await assert.rejects(
    check('pdf-pipeline', [new File([original, truncated], 'truncated-comment.zip')]),
    /central directory is missing/,
  )
  await assert.rejects(inspectZipResult(new Blob([original, truncated])), /directory is missing/)
})

test('does not interpret a classic directory entry comment as a ZIP64 locator', async () => {
  const original = new Uint8Array(await zipFixture({ 'input.pdf': '%PDF-1.7' }).arrayBuffer())
  const oldEnd = original.length - 22
  const directory = new DataView(original.buffer).getUint32(oldEnd + 16, true)
  const bytes = new Uint8Array(original.length + 20)
  bytes.set(original.subarray(0, oldEnd))
  bytes.set(original.subarray(oldEnd), oldEnd + 20)
  const view = new DataView(bytes.buffer)
  view.setUint16(directory + 32, 20, true)
  view.setUint32(oldEnd, 0x07064b50, true)
  view.setUint32(oldEnd + 16, 1, true)
  view.setUint32(oldEnd + 20 + 12, oldEnd - directory + 20, true)
  assert.deepEqual(await check('pdf-pipeline', [new File([bytes], 'comment-locator.zip')]), [
    'input.pdf',
  ])
})

test('accepts signed ZIP central directories without ignoring unexpected trailing records', async () => {
  const original = new Uint8Array(await zipFixture({ 'input.pdf': '%PDF-1.7' }).arrayBuffer())
  const endOffset = original.length - 22
  const signature = new Uint8Array(10)
  const header = new DataView(signature.buffer)
  header.setUint32(0, 0x05054b50, true)
  header.setUint16(4, 4, true)
  signature.set([1, 2, 3, 4], 6)

  const signed = new Uint8Array(original.length + signature.length)
  signed.set(original.subarray(0, endOffset))
  signed.set(signature, endOffset)
  signed.set(original.subarray(endOffset), endOffset + signature.length)
  const view = new DataView(signed.buffer)
  view.setUint32(
    signed.length - 10,
    new DataView(original.buffer).getUint32(original.length - 10, true) + signature.length,
    true,
  )
  assert.deepEqual(await check('pdf-pipeline', [new File([signed], 'signed.zip')]), ['input.pdf'])
  assert.equal((await inspectZipResult(new Blob([signed]))).entries[0]?.name, 'input.pdf')

  const invalid = signed.slice()
  new DataView(invalid.buffer).setUint16(endOffset + 4, 5, true)
  await assert.rejects(
    check('pdf-pipeline', [new File([invalid], 'invalid-signature.zip')]),
    /trailing data/,
  )
  await assert.rejects(inspectZipResult(new Blob([invalid])), /Unexpected ZIP directory contents/)
})

test('accepts empty ZIPs when other source inputs are available', async () => {
  const empty = zipFixture({})
  const input = new File(['%PDF-1.7'], 'original.pdf')
  assert.deepEqual(await check('pdf-pipeline', [empty], { files: [input] }), [])
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'docs/': '', '__MACOSX/._input.pdf': 'metadata' })], {
      files: [input],
    }),
    [],
  )
  assert.deepEqual(await check('html-pdf', [empty]), [])
  await assert.rejects(check('pdf-pipeline', [empty]), /at least one source PDF/)
  await assert.rejects(check('office-pdf', [empty]), /at least one source document/)
})

test('accepts self-extracting ZIPs with a prefixed stub and relative directory offsets', async () => {
  const original = zipFixture({ 'document.pdf': '%PDF-1.7' })
  const stub = new TextEncoder().encode('MZ\x90\x00valid stub prefix')
  const archive = new File([stub, original], 'self-extracting.zip')
  assert.deepEqual(await check('pdf-pipeline', [archive]), ['document.pdf'])
  assert.equal((await inspectZipResult(archive)).entries[0]?.name, 'document.pdf')
})

test('accepts PDF-only pipeline ZIPs, known Office files, and Chromium assets', async () => {
  await check('pdf-pipeline', [
    zipFixture({ 'one.pdf': '%PDF-1.7', 'invoices/two.PDF': '%PDF-1.7' }),
  ])
  await check('office-pdf', [zipFixture({ 'report.docx': 'document', 'sheet.xlsx': 'sheet' })])
  await check('html-pdf', [zipFixture({ 'theme.css': 'body {}', 'images/logo.png': 'image' })])
  await check('markdown-shot', [zipFixture({ 'theme.css': 'body {}' })])
})

test('ignores macOS metadata, directory entries and Unix symlinks like Gotenberg', async () => {
  const archive = zipFixture({
    '__MACOSX/._input.pdf': 'macOS metadata',
    'docs/._input.pdf': 'AppleDouble metadata',
    '._extra.txt': 'AppleDouble metadata',
    'docs/': '',
    'input.pdf': '%PDF-1.7',
  })
  assert.deepEqual(await check('pdf-pipeline', [archive]), ['input.pdf'])
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ '__MACOSX/._input.pdf': 'metadata' })]),
    /at least one source PDF/,
  )

  const symlink = new Uint8Array(
    await zipFixture({ 'link.txt': 'input.pdf', 'input.pdf': '%PDF-1.7' }).arrayBuffer(),
  )
  // First central entry: built-by Unix and external attributes = S_IFLNK.
  const directoryOffset = new DataView(symlink.buffer).getUint32(symlink.length - 6, true)
  const directory = new DataView(symlink.buffer)
  directory.setUint16(directoryOffset + 4, 0x0314, true)
  directory.setUint32(directoryOffset + 38, 0o120777 << 16, true)
  assert.deepEqual(await check('pdf-pipeline', [new File([symlink], 'linked.zip')]), ['input.pdf'])
})

test('ignores DOS directory attributes and macOS symlinks when inspecting ZIP entries', async () => {
  const makeArchive = async (creator: number, attributes: number): Promise<File> => {
    const data = new Uint8Array(
      await zipFixture({ 'index.html': '', 'theme.css': 'body {}' }).arrayBuffer(),
    )
    const directory = new DataView(data.buffer)
    const firstEntry = directory.getUint32(data.length - 6, true)
    // ZIP central headers encode creator OS in the top byte of version-made-by.
    directory.setUint16(firstEntry + 4, (creator << 8) | 20, true)
    directory.setUint32(firstEntry + 38, attributes, true)
    return new File([data], `creator-${creator}.zip`)
  }

  // FAT, NTFS and VFAT creators recognise the DOS directory bit, even without
  // a trailing slash. Gotenberg skips the entry before checking index.html.
  for (const creator of [0, 11, 14]) {
    assert.deepEqual(await check('html-pdf', [await makeArchive(creator, 0x10)]), ['theme.css'])
  }
  // Unix and macOS use the type encoded in the upper 16 attribute bits.
  for (const creator of [3, 19]) {
    assert.deepEqual(await check('html-pdf', [await makeArchive(creator, 0o120777 << 16)]), [
      'theme.css',
    ])
    await assert.rejects(
      check('html-pdf', [await makeArchive(creator, (0o100644 << 16) | 0x10)]),
      /duplicate or reserved filename: index.html/,
    )
  }
})

test('normalises effective ZIP names like Gotenberg and prevents Unicode filename collisions', async () => {
  assert.deepEqual(await check('pdf-pipeline', [zipFixture({ 'cafe\u0301.pdf': '%PDF' })]), [
    'café.pdf',
  ])
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'café.pdf': '%PDF', 'cafe\u0301.pdf': '%PDF' })]),
    ['café.pdf', 'café.pdf'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'cafe\u0301.pdf': '%PDF' })], {
      files: [new File(['%PDF'], 'café.pdf')],
    }),
    ['café.pdf'],
  )
})

test('allows exact referenced PDF-pipeline and Office stage assets within ZIP inputs', async () => {
  const pdfStagePayload: ConversionPayload = {
    ...payload,
    fields: {
      stages: JSON.stringify([
        { op: 'stamp-image', image: 'brand.png', x: 12, y: 12 },
        { op: 'attach', file: 'invoice.xml' },
      ]),
    },
  }
  assert.deepEqual(
    await check(
      'pdf-pipeline',
      [
        zipFixture({
          'input.pdf': '%PDF-1.7',
          'assets/brand.png': 'image',
          'invoice.xml': '<invoice />',
        }),
      ],
      { payload: pdfStagePayload },
    ),
    ['input.pdf', 'brand.png', 'invoice.xml'],
  )
  // Unreferenced resources are harmless; Gotenberg ignores them when
  // selecting source PDFs, and still reports missing named assets if needed.
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'input.pdf': '%PDF', 'brand.PNG': 'image' })], {
      payload: pdfStagePayload,
    }),
    ['input.pdf', 'brand.PNG'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'input.pdf': '%PDF', 'brand.png': 'image' })], {
      payload,
    }),
    ['input.pdf', 'brand.png'],
  )

  const officePayload: ConversionPayload = {
    ...payload,
    conversionStages: JSON.stringify([{ op: 'attach', file: 'invoice.bin' }]),
  }
  assert.deepEqual(
    await check(
      'office-pdf',
      [
        zipFixture({
          'report.docx': 'office',
          'invoice.bin': 'receipt',
        }),
      ],
      { payload: officePayload },
    ),
    ['report.docx', 'invoice.bin'],
  )
  assert.deepEqual(
    await check('office-pdf', [
      zipFixture({ 'report.docx': 'office', 'invoice.bin': 'unreferenced' }),
    ]),
    ['report.docx', 'invoice.bin'],
  )
})

test('rejects asset-only ZIPs without a source document, including referenced PDFs', async () => {
  const attachPayload: ConversionPayload = {
    ...payload,
    fields: { stages: '[{"op":"attach","file":"attachment.pdf"}]' },
  }
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'attachment.pdf': '%PDF' })], {
      payload: attachPayload,
    }),
    /at least one source PDF/,
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'attachment.pdf': '%PDF' })], {
      payload: attachPayload,
      files: [new File(['%PDF'], 'original.pdf')],
    }),
    ['attachment.pdf'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'attachment.pdf': '%PDF' })], {
      payload: { ...attachPayload, downloadFrom: [{ url: 'https://example.com/source.pdf' }] },
    }),
    ['attachment.pdf'],
  )
  const officePayload: ConversionPayload = {
    ...payload,
    conversionStages: '[{"op":"attach","file":"attachment.docx"}]',
  }
  await assert.rejects(
    check('office-pdf', [zipFixture({ 'attachment.docx': 'asset' })], {
      payload: officePayload,
    }),
    /at least one source document/,
  )
})

test('recognises Gotenberg 9.2 downloadFrom.filename as a stage asset when checking ZIP sources', async () => {
  const stages = '[{"op":"attach","file":"attachment.pdf"}]'
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'notes.txt': 'unrelated' })], {
      payload: {
        ...payload,
        fields: { stages },
        downloadFrom: [{ url: 'https://example.com/object', filename: 'attachment.pdf' }],
      },
    }),
    /at least one source PDF/,
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'notes.txt': 'unrelated' })], {
      payload: {
        ...payload,
        fields: { stages },
        downloadFrom: [{ url: 'https://example.com/object', name: 'attachment.pdf', filename: '' }],
      },
    }),
    /at least one source PDF/,
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'notes.txt': 'unrelated' })], {
      payload: {
        ...payload,
        fields: { stages },
        downloadFrom: [{ url: 'https://example.com/object', filename: 'input.pdf' }],
      },
    }),
    ['notes.txt'],
  )
})

test('accepts unrelated ZIP resources while requiring a real PDF or Office input', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 35 }, (_, index) => [`document-${index}.pdf`, '%PDF-1.7']),
  )
  const names = await check('pdf-pipeline', [zipFixture({ ...many, 'README.txt': 'notes' })])
  assert.equal(names.length, 36)
  assert.ok(names.includes('README.txt'))
  assert.deepEqual(
    await check('office-pdf', [zipFixture({ 'document.docx': 'good', 'obsolete.epub': 'extra' })]),
    ['document.docx', 'obsolete.epub'],
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'README.txt': 'no PDF here' })]),
    /at least one source PDF/,
  )
  await assert.rejects(
    check('office-pdf', [zipFixture({ 'obsolete.epub': 'no supported source' })]),
    /at least one source document/,
  )
})

test('permits duplicate unrelated archive resources but protects referenced stage assets', async () => {
  assert.deepEqual(
    await check('pdf-pipeline', [
      zipFixture({
        'source.pdf': '%PDF',
        'docs/README.txt': 'first',
        'other/README.txt': 'second',
      }),
    ]),
    ['source.pdf', 'README.txt', 'README.txt'],
  )
  assert.deepEqual(
    await check('html-pdf', [zipFixture({ 'first/logo.png': 'one', 'second/logo.png': 'two' })]),
    ['logo.png', 'logo.png'],
  )
})

test('accepts same-name source documents within ZIPs and alongside local PDFs', async () => {
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'input.pdf': '1', 'other/input.pdf': '2' })]),
    ['input.pdf', 'input.pdf'],
  )
  assert.deepEqual(
    await check('office-pdf', [
      zipFixture({ 'first.docx': '1' }, 'first.zip'),
      zipFixture({ 'first.docx': '2' }, 'second.zip'),
    ]),
    ['first.docx', 'first.docx'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'source.pdf': '%PDF-1.7' })], {
      files: [new File(['%PDF'], 'source.pdf')],
    }),
    ['source.pdf'],
  )
  // A named pipeline input must still have an unambiguous identity.
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'stamp.pdf': 'one', 'second/stamp.pdf': 'two' })], {
      payload: {
        ...payload,
        fields: { stages: '[{"op":"stamp-pdf","source":"stamp.pdf"}]' },
      },
      files: [new File(['%PDF'], 'input.pdf')],
    }),
    /duplicate or reserved filename: stamp\.pdf/,
  )
  await assert.rejects(
    check('html-pdf', [zipFixture({ 'logo.png': 'image' })], {
      auxiliary: [new File(['image'], 'logo.png')],
    }),
    /duplicate or reserved filename: logo\.png/,
  )
  await assert.rejects(
    check('office-pdf', [zipFixture({ 'signature.png': 'asset' })], {
      stageFiles: [new File(['asset'], 'signature.png')],
    }),
    /duplicate or reserved filename: signature\.png/,
  )
})

test('rejects archive assets that could shadow generated HTML or Markdown sources', async () => {
  await assert.rejects(
    check('html-pdf', [zipFixture({ 'index.html': 'shadow' })]),
    /duplicate or reserved filename/,
  )
  for (const name of ['header.html', 'footer.html']) {
    assert.deepEqual(await check('html-pdf', [zipFixture({ [name]: 'template' })]), [name])
    await assert.rejects(
      check('html-pdf', [zipFixture({ [name]: 'shadow' })], {
        payload: { ...payload, [`${name.split('.')[0]}Html`]: 'generated' },
      }),
      /duplicate or reserved filename/,
    )
  }
  await assert.rejects(
    check('markdown-pdf', [zipFixture({ 'custom.md': '# duplicate' })], {
      payload: {
        ...payload,
        markdownName: 'custom.md',
      },
    }),
    /duplicate or reserved filename: custom\.md/,
  )
  await assert.rejects(
    check('markdown-shot', [zipFixture({ 'chapter2.md': '# duplicate' })], {
      payload: {
        ...payload,
        markdownFiles: [{ name: 'chapter2.md', content: '# source' }],
      },
    }),
    /duplicate or reserved filename: chapter2\.md/,
  )
})

test('rejects unsafe paths, corrupt directories, encrypted ZIPs, and archives without sources', async () => {
  for (const name of ['../secrets.pdf', '/etc/secrets.pdf', 'C:\\secrets.pdf']) {
    await assert.rejects(check('pdf-pipeline', [zipFixture({ [name]: '%PDF' })]), /paths/)
  }
  const truncated = zipFixture({ 'file.pdf': '%PDF-1.7' })
  await assert.rejects(
    check('pdf-pipeline', [new File([await truncated.slice(0, 4).arrayBuffer()], 'bad.zip')]),
    /central directory is missing/,
  )
  const corrupt = new Uint8Array(await truncated.arrayBuffer())
  const view = new DataView(corrupt.buffer)
  view.setUint32(corrupt.length - 6, 0xffffff00, true)
  await assert.rejects(
    check('pdf-pipeline', [new File([corrupt], 'bad-index.zip')]),
    /central directory is invalid/,
  )
  const encrypted = new Uint8Array(await truncated.arrayBuffer())
  new DataView(encrypted.buffer).setUint16(30 + 'file.pdf'.length + '%PDF-1.7'.length + 8, 1, true)
  await assert.rejects(
    check('pdf-pipeline', [new File([encrypted], 'encrypted.zip')]),
    /encrypted ZIP entries/,
  )
  const empty = new Uint8Array(22)
  new DataView(empty.buffer).setUint32(0, 0x06054b50, true)
  await assert.rejects(
    check('office-pdf', [new File([empty], 'no-files.zip')]),
    /at least one source document/,
  )
  const zip64 = new Uint8Array(await truncated.arrayBuffer())
  new DataView(zip64.buffer).setUint32(zip64.length - 10, 0xffffffff, true)
  await assert.rejects(check('pdf-pipeline', [new File([zip64], 'zip64.zip')]), /ZIP64 locator/)
})

test('accepts a valid ZIP64 end record and rejects an overlapping central directory', async () => {
  const original = new Uint8Array(await zipFixture({ 'source.pdf': '%PDF-1.7' }).arrayBuffer())
  const oldEnd = original.byteLength - 22
  const classic = new DataView(original.buffer, oldEnd)
  const total = classic.getUint16(10, true)
  const directorySize = classic.getUint32(12, true)
  const directoryOffset = classic.getUint32(16, true)
  const bytes = new Uint8Array(original.length + 56 + 20)
  bytes.set(original.subarray(0, oldEnd))
  bytes.set(original.subarray(oldEnd), oldEnd + 76)
  const zip64 = new DataView(bytes.buffer, oldEnd, 56)
  zip64.setUint32(0, 0x06064b50, true)
  zip64.setBigUint64(4, 44n, true)
  zip64.setUint16(12, 45, true)
  zip64.setUint16(14, 45, true)
  zip64.setBigUint64(24, BigInt(total), true)
  zip64.setBigUint64(32, BigInt(total), true)
  zip64.setBigUint64(40, BigInt(directorySize), true)
  zip64.setBigUint64(48, BigInt(directoryOffset), true)
  const locator = new DataView(bytes.buffer, oldEnd + 56, 20)
  locator.setUint32(0, 0x07064b50, true)
  locator.setBigUint64(8, BigInt(oldEnd), true)
  locator.setUint32(16, 1, true)
  const end = new DataView(bytes.buffer, oldEnd + 76, 22)
  end.setUint16(8, 0xffff, true)
  end.setUint16(10, 0xffff, true)
  end.setUint32(12, 0xffffffff, true)
  end.setUint32(16, 0xffffffff, true)
  assert.deepEqual(await check('pdf-pipeline', [new File([bytes], 'valid.zip')]), ['source.pdf'])
  const prefix = new TextEncoder().encode('MZstub')
  await assert.rejects(
    check('pdf-pipeline', [new File([prefix, bytes], 'bad-sfx64.zip')]),
    /ZIP64 end record is invalid/,
  )
  // Go accepts a preamble when the ZIP64 locator identifies the physical record.
  const prefixed = bytes.slice()
  new DataView(prefixed.buffer).setBigUint64(oldEnd + 56 + 8, BigInt(oldEnd + prefix.length), true)
  assert.deepEqual(await check('pdf-pipeline', [new File([prefix, prefixed], 'sfx64.zip')]), [
    'source.pdf',
  ])

  // A maximum-length ZIP comment and trailer can push the ZIP64 locator
  // outside the bounded first tail read.
  const maxComment = new Uint8Array(bytes.length + 65_535 + 990)
  maxComment.set(bytes)
  new DataView(maxComment.buffer).setUint16(bytes.length - 2, 65_535, true)
  maxComment.fill(65, bytes.length)
  assert.deepEqual(await check('pdf-pipeline', [new File([maxComment], 'zip64-max-comment.zip')]), [
    'source.pdf',
  ])

  // A directory cannot overlap the ZIP64 EOCD, even when it finishes before the locator.
  zip64.setBigUint64(40, BigInt(directorySize + 4), true)
  await assert.rejects(
    check('pdf-pipeline', [new File([bytes], 'overlap.zip')]),
    /ZIP central directory is invalid/,
  )
})

test('limits central-directory memory and never reads or unpacks entry contents', async () => {
  const archive = zipFixture({ 'large.pdf': new Uint8Array(2_000_000) })
  const readSizes: number[] = []
  const slice = archive.slice.bind(archive)
  archive.slice = (start?: number, end?: number, type?: string) => {
    readSizes.push((end ?? archive.size) - (start ?? 0))
    return slice(start, end, type)
  }
  await check('pdf-pipeline', [archive])
  assert.deepEqual(readSizes.length, 2)
  assert.ok(readSizes.every((size) => size <= 65 * 1024))
  assert.ok(readSizes.reduce((sum, size) => sum + size, 0) < 70_000)
})

test('matches the default upstream ZIP entry limit before requesting extraction', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 10_001 }, (_, index) => [`file-${index}.pdf`, 'x']),
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture(many)]),
    /too many entries or is too large/,
  )
})

test('keeps case-distinct ZIP names separate like the Gotenberg file registry', async () => {
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'Report.PDF': '%PDF', 'report.pdf': '%PDF' })]),
    ['Report.PDF', 'report.pdf'],
  )
  assert.deepEqual(
    await check('office-pdf', [
      zipFixture({ 'Budget.DOCX': 'one' }, 'budget-1.zip'),
      zipFixture({ 'budget.docx': 'two' }, 'budget-2.zip'),
    ]),
    ['Budget.DOCX', 'budget.docx'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'report.pdf': '%PDF' })], {
      files: [new File(['%PDF'], 'Report.pdf')],
    }),
    ['report.pdf'],
  )
  assert.deepEqual(await check('html-pdf', [zipFixture({ 'HEADER.HTML': 'asset' })]), [
    'HEADER.HTML',
  ])
  assert.deepEqual(
    await check('pdf-pipeline', [zipFixture({ 'cafe\u0301.pdf': '%PDF', 'café.pdf': '%PDF' })]),
    ['café.pdf', 'café.pdf'],
  )
})

test('preserves a leading U+FEFF in ZIP entry filenames instead of treating it as a text BOM', async () => {
  assert.deepEqual(
    await check('html-pdf', [zipFixture({ '\uFEFFindex.html': 'distinct resource' })]),
    ['\uFEFFindex.html'],
  )
  assert.deepEqual(
    await check('pdf-pipeline', [
      zipFixture({ 'report.pdf': '%PDF-1.7', '\uFEFFreport.pdf': '%PDF-1.7' }),
    ]),
    ['report.pdf', '\uFEFFreport.pdf'],
  )
})

test('matches Go filename replacement for incomplete UTF-8 sequences in ZIP metadata', async () => {
  const bytes = new Uint8Array(await zipFixture({ 'aa.pdf': '%PDF-1.7' }).arrayBuffer())
  const name = new TextEncoder().encode('aa.pdf')
  // Replace the same filename in both ZIP headers without changing lengths.
  for (let offset = 0; offset <= bytes.length - name.length; offset++) {
    if (name.every((byte, index) => bytes[offset + index] === byte)) {
      bytes.set([0xe2, 0x82], offset)
    }
  }
  assert.deepEqual(await check('pdf-pipeline', [new File([bytes], 'legacy.zip')]), [
    '\ufffd\ufffd.pdf',
  ])
})

test('prefers the declared absolute ZIP directory over a second directory after a gap, like Go', async () => {
  const original = new Uint8Array(await zipFixture({ 'index.html': 'original' }).arrayBuffer())
  const end = original.length - 22
  const offset = new DataView(original.buffer).getUint32(end + 16, true)
  const shadow = original.slice(offset, end)
  shadow.set(new TextEncoder().encode('other.html'), 46)
  const gap = new TextEncoder().encode('non-directory padding')
  // Go stops at the gap and reads the first directory, not the shadow next to EOCD.
  for (const trailing of [[], [shadow]]) {
    const archive = new File(
      [original.subarray(0, end), gap, ...trailing, original.subarray(end)],
      'offset.zip',
    )
    await assert.rejects(check('html-pdf', [archive]), /duplicate or reserved filename: index.html/)
    assert.equal((await inspectZipResult(archive)).entries[0]?.name, 'index.html')
  }
})

test('treats unrecognised Unix type bits as regular files, like Go', async () => {
  const data = new Uint8Array(await zipFixture({ 'input.pdf': '%PDF-1.7' }).arrayBuffer())
  const view = new DataView(data.buffer)
  const offset = view.getUint32(data.length - 6, true)
  view.setUint16(offset + 4, 0x0314, true)
  view.setUint32(offset + 38, 0o030644 << 16, true)
  assert.deepEqual(await check('pdf-pipeline', [new File([data], 'unknown-mode.zip')]), [
    'input.pdf',
  ])
})

/** Replace the first central header's ordinary 32-bit field with a ZIP64
 * sentinel, optionally inserting the corresponding ZIP64 extra record.
 */
async function entryZip64(field: number, extra: Uint8Array): Promise<File> {
  const original = new Uint8Array(await zipFixture({ 'input.pdf': '%PDF-1.7' }).arrayBuffer())
  const end = original.length - 22
  const directory = new DataView(original.buffer).getUint32(end + 16, true)
  const bytes = new Uint8Array(original.length + extra.length)
  bytes.set(original.subarray(0, end))
  bytes.set(extra, end)
  bytes.set(original.subarray(end), end + extra.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(directory + field, 0xffffffff, true)
  view.setUint16(directory + 30, extra.length, true)
  view.setUint32(end + extra.length + 12, end - directory + extra.length, true)
  return new File([bytes], 'entry-zip64.zip')
}

test.each([20, 42])(
  'rejects ZIP64 central entries missing a required extended field at offset %s',
  async (field) => {
    const missing = await entryZip64(field, new Uint8Array())
    await assert.rejects(zipEntryNames(missing), /incomplete ZIP64 extra data/)
    await assert.rejects(inspectZipResult(missing), /Invalid ZIP64 directory entry/)
    await assert.rejects(
      zipEntryNames(await entryZip64(field, new Uint8Array([1, 0, 4, 0, 1, 0, 0, 0]))),
      /incomplete ZIP64 extra data/,
    )
  },
)

test('mirrors Go ZIP64 per-entry extra data handling without requiring a ZIP64 end record', async () => {
  const extra = new Uint8Array(12)
  const view = new DataView(extra.buffer)
  view.setUint16(0, 1, true)
  view.setUint16(2, 8, true)
  view.setBigUint64(4, 8n, true)
  const compressed = await entryZip64(20, extra)
  assert.deepEqual(await zipEntryNames(compressed), ['input.pdf'])
  assert.equal((await inspectZipResult(compressed)).entries[0]?.name, 'input.pdf')
  view.setBigUint64(4, 0n, true)
  assert.deepEqual(await zipEntryNames(await entryZip64(42, extra)), ['input.pdf'])
  // Go deliberately tolerates a missing uncompressed size, not an incomplete tag.
  assert.deepEqual(await zipEntryNames(await entryZip64(24, new Uint8Array())), ['input.pdf'])
  await assert.rejects(
    zipEntryNames(await entryZip64(24, new Uint8Array([1, 0, 0, 0]))),
    /incomplete ZIP64 extra data/,
  )
})
