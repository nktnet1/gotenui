import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  downloadFilename,
  formatBytes,
  responseExtension,
  safeAttachmentDisposition,
} from '#/lib/security'

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

test('normalizes disposition while preserving ordinary upstream output names', () => {
  assert.equal(
    safeAttachmentDisposition(
      'attachment; filename="report (1).pdf"',
      'url-pdf',
      'application/pdf',
    ),
    'attachment; filename="report (1).pdf"',
  )
  assert.equal(
    safeAttachmentDisposition('attachment; filename="capture.jpg"', 'url-shot', 'image/jpeg'),
    'attachment; filename="capture.jpg"',
  )
  assert.equal(
    safeAttachmentDisposition(null, 'metadata-read', 'application/json'),
    'attachment; filename="metadata-read.json"',
  )
})

test('forces attachment disposition and a media-type-consistent filename', () => {
  for (const [header, type, expected] of [
    ['inline; filename="../../invoice.html"', 'application/pdf', 'invoice.pdf'],
    ['attachment; filename="original.pdf"', 'application/zip', 'original.zip'],
    ['inline; filename="evil.svg"', 'image/png', 'evil.png'],
    ['attachment; filename="CON.pdf"', 'application/pdf', 'file-CON.pdf'],
    [
      "attachment; filename*=UTF-8''%2Ftmp%2Fstatement%20%281%29.exe",
      'application/pdf',
      'statement (1).pdf',
    ],
    ['attachment; filename="..."', 'application/pdf', 'url-pdf.pdf'],
  ] as const) {
    assert.equal(
      safeAttachmentDisposition(header, 'url-pdf', type),
      `attachment; filename="${expected}"`,
    )
  }
})

test('validated request filenames take precedence over untrusted upstream suggestions', () => {
  assert.equal(
    safeAttachmentDisposition(
      'inline; filename="evil.html"',
      'url-pdf',
      'application/pdf',
      'report 2026',
    ),
    'attachment; filename="report 2026.pdf"',
  )
  const veryLong = safeAttachmentDisposition(
    `attachment; filename="${'a'.repeat(200)}.pdf"`,
    'url-pdf',
    'application/pdf',
  )
  assert.match(veryLong, /^attachment; filename="a+\.pdf"$/)
  assert.ok(veryLong.length <= 'attachment; filename=""'.length + 140)
})
