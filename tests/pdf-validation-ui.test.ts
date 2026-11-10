import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { OPERATION_BY_ID } from '#/lib/operations'
import { parsePdfValidationReport } from '#/lib/pdf-validation-report'
import { JobPanel } from '#/tools/shared/job-panel'

const operation = OPERATION_BY_ID.get('pdf-validate')
assert.ok(operation)

test('compliant Factur-X findings remain visible with review guidance', () => {
  const validation = parsePdfValidationReport(
    JSON.stringify({
      'invoice.pdf': {
        profile: 'Factur-X',
        compliant: true,
        violations: [{ description: 'Optional rule warning', severity: 'warning' }],
      },
    }),
  )
  assert.ok(validation)
  const html = renderToStaticMarkup(
    createElement(JobPanel, {
      operation,
      backendVersion: '9.3.0',
      files: [],
      auxFiles: [],
      postFiles: {},
      source: '',
      pending: false,
      lastDownload: {
        name: 'report.json',
        url: 'blob:pdf-validation-report',
        type: 'application/json',
        size: 200,
        validation,
      },
      recent: [],
      onClearResult: () => {},
      acceptedWebhook: null,
    }),
  )
  assert.match(html, /Report requires review/)
  assert.match(html, /Compliant with findings/)
  assert.match(html, /Optional rule warning/)
  assert.doesNotMatch(html, /Validation complete: compliant</)
})
