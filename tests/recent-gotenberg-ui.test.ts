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
