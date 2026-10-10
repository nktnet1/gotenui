import assert from 'node:assert/strict'
import { expect, test } from 'vitest'
import { GROUPS, OPERATION_BY_ID, OPERATIONS, operationDefaults } from '#/lib/operations'

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

// Independent of the catalogue itself: extracted from the supplied Gotenberg route overview.
// Adding, removing or renaming an official processing route must change this contract test.
const documentedRoutes = [
  '/forms/chromium/convert/url',
  '/forms/chromium/convert/html',
  '/forms/chromium/convert/markdown',
  '/forms/libreoffice/convert',
  '/forms/chromium/screenshot/url',
  '/forms/chromium/screenshot/html',
  '/forms/chromium/screenshot/markdown',
  '/forms/pdfengines/merge',
  '/forms/pdfengines/split',
  '/forms/pdfengines/convert',
  '/forms/pdfengines/metadata/read',
  '/forms/pdfengines/metadata/write',
  '/forms/pdfengines/bookmarks/read',
  '/forms/pdfengines/bookmarks/write',
  '/forms/pdfengines/embed',
  '/forms/pdfengines/factur-x',
  '/forms/pdfengines/flatten',
  '/forms/pdfengines/optimize',
  '/forms/pdfengines/watermark',
  '/forms/pdfengines/stamp',
  '/forms/pdfengines/rotate',
  '/forms/pdfengines/encrypt',
] as const

test('implements every published Gotenberg multipart processing endpoint', () => {
  expect(OPERATIONS.map(({ path }) => path).sort()).toEqual([...documentedRoutes].sort())
})
