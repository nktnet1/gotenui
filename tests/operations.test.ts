import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GROUPS, OPERATION_BY_ID, OPERATIONS, operationDefaults } from '../src/lib/operations.ts'

test('all operation identifiers and Gotenberg endpoints are unique', () => {
  assert.equal(OPERATIONS.length, 22)
  assert.equal(OPERATION_BY_ID.size, OPERATIONS.length)
  assert.equal(new Set(OPERATIONS.map((operation) => operation.path)).size, OPERATIONS.length)
  for (const operation of OPERATIONS) {
    assert.match(operation.path, /^\/forms\/(chromium|libreoffice|pdfengines)\//)
    assert.ok(GROUPS.includes(operation.group))
    assert.ok(operation.docs && !operation.docs.startsWith('/'))
    assert.equal(new Set(operation.fields.map((field) => field.name)).size, operation.fields.length)
    for (const field of operation.fields) {
      if (field.kind === 'select') assert.ok(field.options?.length)
      if (field.defaultValue !== undefined && field.kind === 'select')
        assert.ok(field.options?.includes(String(field.defaultValue)))
    }
  }
})

test('defaults are present only for declared fields', () => {
  for (const operation of OPERATIONS) {
    const defaults = operationDefaults(operation)
    for (const key of Object.keys(defaults))
      assert.ok(operation.fields.some((field) => field.name === key))
  }
})

test('HTML and Markdown operations use the documented Chromium endpoints', () => {
  for (const output of ['convert', 'screenshot']) {
    for (const input of ['url', 'html', 'markdown']) {
      const matches = OPERATIONS.filter(
        (operation) => operation.path === `/forms/chromium/${output}/${input}`,
      )
      assert.equal(matches.length, 1)
      assert.equal(matches[0]?.input, input)
    }
  }
})

test('special auxiliary upload names agree with Gotenberg', () => {
  assert.equal(OPERATION_BY_ID.get('embed')?.auxiliary?.name, 'embeds')
  assert.equal(OPERATION_BY_ID.get('factur-x')?.auxiliary?.name, 'facturxXml')
  assert.equal(OPERATION_BY_ID.get('watermark')?.auxiliary?.name, 'watermark')
  assert.equal(OPERATION_BY_ID.get('stamp')?.auxiliary?.name, 'stamp')
})
