import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { mergeBookmarks, mergeUploadFilename } from '#/lib/merge-order'
import { OPERATION_BY_ID } from '#/lib/operations'
import { validateFiles, validatePayload } from '#/lib/validation'

const pdf = (name: string, content: string) =>
  new File([content], name, { type: 'application/pdf' })

test('prefixes merge filenames numerically while preserving original names and contents', async () => {
  assert.equal(mergeUploadFilename('Z Final.pdf', 0, 20), '01_Z Final.pdf')
  assert.equal(mergeUploadFilename('10 Notes.pdf', 9, 20), '10_10 Notes.pdf')
  const operation = OPERATION_BY_ID.get('merge')
  assert.ok(operation)
  const originals = [
    pdf('z-last.pdf', 'last'),
    pdf('2-first.pdf', 'numeric'),
    pdf('duplicate.pdf', 'first duplicate'),
    pdf('duplicate.pdf', 'second duplicate'),
  ]
  const { payload } = validatePayload({ operation: 'merge', fields: {}, advanced: {} })
  validateFiles(operation, originals, [], 4_000_000, payload)
  const serialized = createGotenbergForm(operation, payload, originals, [])
  const files = serialized.getAll('files') as File[]
  assert.deepEqual(
    files.map(({ name }) => name),
    ['01_z-last.pdf', '02_2-first.pdf', '03_duplicate.pdf', '04_duplicate.pdf'],
  )
  assert.deepEqual(await Promise.all(files.map((file) => file.text())), [
    'last',
    'numeric',
    'first duplicate',
    'second duplicate',
  ])
})

test('retains filename-keyed merge bookmarks including duplicate filenames and remote entries', () => {
  const values = [
    { title: 'first', page: 1 },
    { title: 'second', page: 1 },
  ]
  const json = JSON.stringify({ 'same.pdf': values, 'remote.pdf': values })
  assert.deepEqual(JSON.parse(mergeBookmarks(json, ['same.pdf', 'same.pdf'])), {
    'remote.pdf': values,
    '01_same.pdf': values,
    '02_same.pdf': values,
  })
  assert.equal(
    mergeBookmarks('[{"title":"Whole document","page":1}]', ['a.pdf']),
    '[{"title":"Whole document","page":1}]',
  )
})

test('rejects colliding names for other PDF routes and invalid merge bookmark JSON', () => {
  const operation = OPERATION_BY_ID.get('split')
  assert.ok(operation)
  assert.throws(
    () => validateFiles(operation, [pdf('same.pdf', 'one'), pdf('same.pdf', 'two')], [], 1000),
    /Duplicate filename/,
  )
  assert.throws(
    () => validatePayload({ operation: 'merge', fields: {}, advanced: { bookmarks: '{' } }),
    /Unsupported advanced field: bookmarks/,
  )
})
