import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadFilename, formatBytes, responseExtension } from '../src/lib/security.ts'

test('sanitizes filenames from untrusted Gotenberg responses', () => {
  assert.equal(
    downloadFilename('attachment; filename="../../secret.pdf"', 'result.pdf'),
    'secret.pdf',
  )
  assert.equal(
    downloadFilename("attachment; filename*=UTF-8''%2Ftmp%2Freport%20%281%29.pdf", 'result.pdf'),
    'report (1).pdf',
  )
  assert.equal(downloadFilename(null, 'result.pdf'), 'result.pdf')
  assert.equal(downloadFilename('inline; filename="..."', 'result.pdf'), 'result.pdf')
})

test('determines extensions and byte counts', () => {
  assert.equal(responseExtension('image/png'), 'png')
  assert.equal(responseExtension('application/zip'), 'zip')
  assert.equal(responseExtension('application/pdf; charset=binary'), 'pdf')
  assert.equal(responseExtension('text/html'), 'bin')
  assert.equal(formatBytes(1024), '1.0 KB')
})
