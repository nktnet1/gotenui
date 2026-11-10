import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { FieldControl } from '#/components/gotenui-app'
import { OPERATION_BY_ID } from '#/lib/operations'

function field(operationId: string, name: string) {
  const result = OPERATION_BY_ID.get(operationId)?.fields.find((item) => item.name === name)
  assert.ok(result, `${operationId}.${name} is not available`)
  return result
}

function markup(operationId: string, name: string, value: string | boolean, version?: string) {
  return renderToStaticMarkup(
    createElement(FieldControl, {
      field: field(operationId, name),
      value,
      onChange: () => {},
      backendVersion: version,
    }),
  )
}

test('Chromium console message checkboxes reflect selections and Gotenberg version', () => {
  const current = '["warning","error"]'
  const modern = markup('url-shot', 'failOnConsoleMessageTypes', current, '8.39.0')
  const choices = modern.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? []
  assert.equal(choices.length, 6)
  assert.equal(choices.filter((input) => input.includes('checked=""')).length, 2)
  assert.ok(choices.every((input) => !input.includes('disabled=""')))
  for (const type of ['log', 'debug', 'info', 'warning', 'error', 'assert']) {
    assert.match(modern, new RegExp(`>${type}</label>`))
  }

  const older = markup('url-shot', 'failOnConsoleMessageTypes', current, '8.38.0')
  const disabled = older.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? []
  assert.equal(disabled.length, 6)
  assert.equal(disabled.filter((input) => input.includes('disabled=""')).length, 4)
  // Switching to an older backend must not trap a previously selected option.
  assert.equal(disabled.filter((input) => input.includes('checked=""')).length, 2)
  assert.ok(!markup('url-shot', 'failOnConsoleMessageTypes', '', 'Unknown').includes('disabled=""'))
})

test('PDF/A-4 choices and LibreOffice PDF tags are disabled only on old versions', () => {
  const previous = markup('pdfa', 'pdfa', 'PDF/A-3b', '8.38.0')
  const unavailable = previous.match(/<option\b[^>]*value="PDF\/A-4"[^>]*>/)?.[0]
  assert.ok(unavailable?.includes('disabled=""'))
  const current = markup('pdfa', 'pdfa', 'PDF/A-4', '8.39.0')
  const available = current.match(/<option\b[^>]*value="PDF\/A-4"[^>]*>/)?.[0]
  assert.ok(available)
  assert.ok(!available.includes('disabled=""'))

  const oldOffice = markup('office-pdf', 'generateTaggedPdf', false, '8.37.0')
  assert.match(oldOffice, /disabled=""/)
  const selectedOldOffice = markup('office-pdf', 'generateTaggedPdf', true, '8.37.0')
  assert.doesNotMatch(selectedOldOffice, /disabled=""/)
  const newOffice = markup('office-pdf', 'generateTaggedPdf', true, '8.38.0')
  assert.doesNotMatch(newOffice, /disabled=""/)
})

test('Gotenberg 9 screenshots expose the upstream quality minimum without changing v8', () => {
  const old = markup('html-shot', 'quality', '0', '8.40.0')
  const modern = markup('html-shot', 'quality', '1', '9.0.0')
  assert.match(old, /min="0"/)
  assert.match(modern, /min="1"/)
  // Office native JPEG quality is already bounded by 1 on both versions.
  assert.match(markup('office-pdf', 'quality', '90', '8.40.0'), /min="1"/)
  assert.match(markup('office-pdf', 'quality', '90', '9.0.0'), /min="1"/)
})

test('Gotenberg 9 Office bookmark levels show only valid choices without changing v8', () => {
  const old = markup('office-pdf', 'openBookmarkLevels', '100', '8.40.0')
  assert.match(old, /type="number"/)
  assert.match(old, /min="-1"/)
  assert.match(old, /max="100"/)

  const modern = markup('office-pdf', 'openBookmarkLevels', '10', '9.3.0')
  assert.match(modern, /<select\b/)
  const choices = Array.from(
    modern.matchAll(/<option\b[^>]*value="([^"]*)"/g),
    ([, value]) => value,
  )
  assert.deepEqual(choices, [
    '',
    '-1',
    ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
  ])
  assert.match(modern, /All levels \(-1\)/)
  assert.doesNotMatch(modern, /type="number"/)

  // Switching a saved v8 draft to v9 should show the unsupported value until corrected.
  const migrated = markup('office-pdf', 'openBookmarkLevels', '100', '9.3.0')
  assert.match(migrated, /<option\b[^>]*value="100"[^>]*disabled=""/)
  assert.match(migrated, /Unsupported bookmark level: 100/)
  assert.doesNotMatch(markup('office-pdf', 'openBookmarkLevels', '', '9.3.0'), /Unsupported/)
})
