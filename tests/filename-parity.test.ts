import assert from 'node:assert/strict'
import { test } from 'vitest'
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
  ]) {
    assert.equal(safeFilename(name), name)
  }
  for (const invalid of [
    '',
    '.',
    '..',
    '  ',
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
