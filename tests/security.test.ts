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

test('preserves international Gotenberg 9.1 attachment filenames with RFC 5987 encoding', () => {
  const name = 'résumé_日本 2026.xml'
  const disposition = safeAttachmentDisposition(
    `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'extract-attachments',
    'application/xml',
    undefined,
    true,
  )
  assert.match(disposition, /filename\*=UTF-8''/)
  assert.equal(downloadFilename(disposition, 'fallback.bin'), name)
  assert.equal(responseExtension('text/plain; charset=utf-8'), 'txt')
  assert.equal(
    safeAttachmentDisposition(null, 'extract-text', 'text/plain'),
    'attachment; filename="extract-text.txt"',
  )
})

test('normalizes Unicode, forbidden filename characters and device names for extracted files', () => {
  assert.equal(downloadFilename('attachment; filename="cafe\u0301.txt"', 'fallback'), 'café.txt')
  assert.equal(
    downloadFilename(
      "attachment; filename*=UTF-8''%2E%2E%2F%2E%2E%2F%E6%97%A5%E6%9C%AC.xml",
      'fallback',
    ),
    '日本.xml',
  )
  assert.equal(downloadFilename('attachment; filename="CON.xml"', 'fallback'), 'file-CON.xml')
  assert.equal(
    downloadFilename('attachment; filename="invoice\u202Eexe.txt"', 'fallback'),
    'invoice_exe.txt',
  )
  const longName = `${'日'.repeat(220)}.xml`
  const sanitized = downloadFilename(
    `attachment; filename*=UTF-8''${encodeURIComponent(longName)}`,
    'fallback.bin',
  )
  assert.ok([...sanitized].length <= 140)
  assert.ok(sanitized.endsWith('.xml'))
})

test('reads Gotenberg quoted filenames containing semicolons and escaped quotes', () => {
  assert.equal(
    downloadFilename('attachment; filename="invoice;Q1.pdf"', 'fallback.pdf'),
    'invoice;Q1.pdf',
  )
  assert.equal(
    safeAttachmentDisposition('attachment; filename="invoice;Q1.pdf"', 'merge', 'application/pdf'),
    'attachment; filename="invoice;Q1.pdf"',
  )
  assert.equal(
    downloadFilename('attachment; filename="report \\"final\\";2026.pdf"', 'fallback.pdf'),
    'report _final_;2026.pdf',
  )
  assert.equal(
    downloadFilename('attachment; filename="report\\\\backup.pdf"', 'fallback.pdf'),
    'backup.pdf',
  )
})

test('ignores parameter lookalikes inside quoted disposition values', () => {
  assert.equal(
    downloadFilename(
      'attachment; comment="decoy; filename*=UTF-8\'\'fake.pdf"; filename="real.pdf"',
      'fallback.pdf',
    ),
    'real.pdf',
  )
  assert.equal(
    downloadFilename('attachment; filename="safe; filename*=UTF-8\'\'fake.pdf"', 'fallback.pdf'),
    "safe; filename_=UTF-8''fake.pdf",
  )
})

test('does not throw while constructing an attachment header from malformed Unicode', () => {
  const disposition = safeAttachmentDisposition(null, 'merge', 'application/pdf', 'report\ud800')
  assert.equal(downloadFilename(disposition, 'fallback'), 'report\ufffd.pdf')
})

test.each(['COM0.pdf', 'LPT0.pdf', 'CONIN$.pdf', 'CONOUT$.pdf', 'NUL .pdf'])(
  'does not return a Windows device filename: %s',
  (name) => {
    const header = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
    assert.equal(downloadFilename(header, 'fallback.pdf'), `file-${name}`)
  },
)

test('does not reintroduce Windows best-fit separators in requested filenames', () => {
  const disposition = safeAttachmentDisposition(
    null,
    'merge',
    'application/pdf',
    'report\uff0farchive\u00a5document',
  )
  assert.equal(downloadFilename(disposition, 'fallback.pdf'), 'report_archive_document.pdf')
})

test('neutralises superscript Windows device suffixes', () => {
  assert.equal(
    downloadFilename("attachment; filename*=UTF-8''COM%C2%B9.pdf", 'fallback.pdf'),
    'COM_.pdf',
  )
  assert.equal(
    downloadFilename("attachment; filename*=UTF-8''LPT%C2%B2.pdf", 'fallback.pdf'),
    'LPT_.pdf',
  )
})
