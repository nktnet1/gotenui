import assert from 'node:assert/strict'
import { test } from 'vitest'
import { addRemoteAttachmentMetadata } from '#/lib/attachment-metadata'
import { filenameKey } from '#/lib/file-names'
import { adaptPdfForm } from '#/lib/gotenberg-pdf-adapter'
import { addBookmarkMapping } from '#/lib/pdf-structure-editors'
import { remoteStageAssets } from '#/lib/remote-stage-assets'
import { safeFilename, validateFiles, validatePayload } from '#/lib/validation'
import { OPERATION_BY_ID } from '#/tools/registry'

test('accepts Gotenberg filename punctuation and Unicode without silently rewriting names', () => {
  for (const name of [
    'R&D.pdf',
    'Q4 & FY26.pdf',
    'Report [final] #2!.pdf',
    'data+chart=2026.csv',
    'résumé (review).pdf',
    'Report "quoted".pdf',
    'hidden-name.pdf',
    '   ', // Gotenberg treats whitespace-only filenames as exact names.
  ]) {
    assert.equal(safeFilename(name), name)
  }
  for (const invalid of [
    '',
    '.',
    '..',
    '../secret.pdf',
    'a\\b.pdf',
    'bad\u0000.pdf',
    'bad\n.pdf',
  ]) {
    assert.throws(() => safeFilename(invalid), /paths|control/)
  }
})

test('preserves valid PDF and named remote asset filenames through payload validation', () => {
  const operation = OPERATION_BY_ID.get('pdf-pipeline')
  assert.ok(operation)
  const { payload } = validatePayload({
    operation: 'pdf-pipeline',
    fields: { stages: '[{"op":"attach","file":"R&D.csv"}]' },
    advanced: {},
    downloadFrom: [{ name: 'R&D.csv', url: 'https://example.test/data.csv' }],
  })
  assert.doesNotThrow(() =>
    validateFiles(operation, [new File(['%PDF-1.7'], 'Q4 & FY26.pdf')], [], 1_000_000, payload),
  )
})

test('matches Gotenberg filenames case-sensitively after NFC normalisation', () => {
  assert.notEqual(filenameKey('Report.pdf'), filenameKey('report.pdf'))
  assert.equal(filenameKey('cafe\u0301.pdf'), filenameKey('café.pdf'))

  const pipeline = OPERATION_BY_ID.get('pdf-pipeline')
  assert.ok(pipeline)
  assert.doesNotThrow(() =>
    validateFiles(
      pipeline,
      [new File(['%PDF-1.7'], 'Report.PDF'), new File(['%PDF-1.7'], 'report.pdf')],
      [],
      1_000_000,
      { fields: { stages: '[{"op":"merge"}]' }, advanced: {} },
    ),
  )
  assert.throws(
    () =>
      validateFiles(
        pipeline,
        [new File(['%PDF-1.7'], 'café.pdf'), new File(['%PDF-1.7'], 'cafe\u0301.pdf')],
        [],
        1_000_000,
      ),
    /Duplicate filename/,
  )

  assert.deepEqual(
    remoteStageAssets(
      [{ name: 'Stamp.png', url: 'https://example.test/stamp.png' }],
      ['Stamp.png'],
      ['stamp.png'],
    ),
    ['Stamp.png'],
  )
  assert.throws(
    () =>
      remoteStageAssets(
        [{ name: 'cafe\u0301.png', url: 'https://example.test/stamp.png' }],
        ['café.png'],
        ['café.png'],
      ),
    /duplicates/,
  )
})

test('preserves case-distinct asset filenames in standalone PDF requests and editors', () => {
  const insert = OPERATION_BY_ID.get('insert-pages')
  assert.ok(insert)
  const legacy = new FormData()
  legacy.append('files', new File(['%PDF-1.7'], 'Appendix.pdf'))
  const { form } = adaptPdfForm(
    insert,
    { operation: insert.id, fields: { at: '0' }, advanced: {} },
    legacy,
    9,
    [new File(['%PDF-1.7'], 'appendix.pdf')],
  )
  assert.deepEqual(
    (form.getAll('files') as File[]).map((file) => file.name),
    ['Appendix.pdf', 'appendix.pdf'],
  )
  assert.deepEqual(JSON.parse(String(form.get('stages'))), [
    { op: 'insert', source: 'appendix.pdf', at: 0 },
  ])

  assert.deepEqual(JSON.parse(addBookmarkMapping('{"Report.pdf":[]}', 'report.pdf')), {
    'Report.pdf': [],
    'report.pdf': [],
  })
  assert.deepEqual(JSON.parse(addRemoteAttachmentMetadata('{"Notes.txt":{}}', 'notes.txt')), {
    'Notes.txt': {},
    'notes.txt': { relationship: 'Unspecified' },
  })
})
