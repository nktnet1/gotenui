import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ConversionPayload } from '#/lib/validation'
import { validateZipInputs } from '#/lib/zip-input-validation'
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
    /include at least one file/,
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

test('normalises effective ZIP names like Gotenberg and prevents Unicode filename collisions', async () => {
  assert.deepEqual(await check('pdf-pipeline', [zipFixture({ 'cafe\u0301.pdf': '%PDF' })]), [
    'café.pdf',
  ])
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'café.pdf': '%PDF', 'cafe\u0301.pdf': '%PDF' })]),
    /duplicate or reserved filename: café\.pdf/,
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'cafe\u0301.pdf': '%PDF' })], {
      files: [new File(['%PDF'], 'café.pdf')],
    }),
    /duplicate or reserved filename: café\.pdf/,
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
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'input.pdf': '%PDF', 'brand.PNG': 'image' })], {
      payload: pdfStagePayload,
    }),
    /requires PDFs or referenced stage assets/,
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'input.pdf': '%PDF', 'brand.png': 'image' })], {
      payload,
    }),
    /requires PDFs or referenced stage assets/,
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
  await assert.rejects(
    check('office-pdf', [zipFixture({ 'report.docx': 'office', 'invoice.bin': 'unreferenced' })]),
    /unsupported Gotenberg 9 Office entry/,
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

test('checks the formats of every ZIP entry, not just the first 30', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 35 }, (_, index) => [`document-${index}.pdf`, '%PDF-1.7']),
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ ...many, 'not-a-pdf.txt': 'bad' })]),
    /PDF pipeline requires PDFs or referenced stage assets.*not-a-pdf\.txt/,
  )
  await assert.rejects(
    check('office-pdf', [zipFixture({ 'document.docx': 'good', 'obsolete.epub': 'bad' })]),
    /unsupported Gotenberg 9 Office entry: obsolete\.epub/,
  )
})

test('rejects input collisions within and across ZIPs and with explicit uploads', async () => {
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'input.pdf': '1', 'other/INPUT.PDF': '2' })]),
    /duplicate or reserved filename: input\.pdf/,
  )
  await assert.rejects(
    check('office-pdf', [
      zipFixture({ 'first.docx': '1' }, 'first.zip'),
      zipFixture({ 'FIRST.docx': '2' }, 'second.zip'),
    ]),
    /duplicate or reserved filename: first\.docx/,
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ 'source.pdf': '%PDF-1.7' })], {
      files: [new File(['%PDF'], 'SOURCE.pdf')],
    }),
    /duplicate or reserved filename: source\.pdf/,
  )
  await assert.rejects(
    check('html-pdf', [zipFixture({ 'logo.png': 'image' })], {
      auxiliary: [new File(['image'], 'LOGO.PNG')],
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
  for (const name of ['index.html', 'HEADER.HTML', 'footer.html']) {
    await assert.rejects(
      check('html-pdf', [zipFixture({ [name]: 'shadow' })]),
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

test('rejects unsafe paths, corrupt directories, encrypted ZIPs, and empty ZIP inputs', async () => {
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
    /include at least one file/,
  )
  const zip64 = new Uint8Array(await truncated.arrayBuffer())
  new DataView(zip64.buffer).setUint32(zip64.length - 10, 0xffffffff, true)
  await assert.rejects(check('pdf-pipeline', [new File([zip64], 'zip64.zip')]), /ZIP64 directories/)
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
  assert.deepEqual(readSizes.length, 3)
  assert.ok(readSizes.every((size) => size <= 65_557))
  assert.ok(readSizes.reduce((sum, size) => sum + size, 0) < 70_000)
})

test('bounds the number of ZIP entries before requesting upstream extraction', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 1_001 }, (_, index) => [`file-${index}.pdf`, 'x']),
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture(many)]),
    /too many entries or is too large/,
  )
})
