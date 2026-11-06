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
): Promise<void> {
  const operation = OPERATION_BY_ID.get(operationId)
  if (!operation) throw new Error(`Missing operation: ${operationId}`)
  await validateZipInputs(
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

test('checks the formats of every ZIP entry, not just the first 30', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 35 }, (_, index) => [`document-${index}.pdf`, '%PDF-1.7']),
  )
  await assert.rejects(
    check('pdf-pipeline', [zipFixture({ ...many, 'not-a-pdf.txt': 'bad' })]),
    /PDF pipeline requires PDF entries.*not-a-pdf\.txt/,
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
