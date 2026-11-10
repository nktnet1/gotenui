import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import {
  MAX_PDF_VALIDATION_SUMMARY_BYTES,
  parsePdfValidationReport,
  summarisePdfValidationBlob,
} from '#/lib/pdf-validation-report'

const valid = () =>
  JSON.stringify({
    'report.pdf': { profile: ['PDF/A-2b', 'PDF/UA-1'], compliant: true, violations: [] },
  })

describe('bounded PDF validation summaries', () => {
  it('parses a compact, consistent Gotenberg 9 compliance result', () => {
    assert.deepEqual(parsePdfValidationReport(valid()), [
      {
        filename: 'report.pdf',
        compliant: true,
        profile: 'PDF/A-2b + PDF/UA-1',
        violations: [],
        totalViolations: 0,
      },
    ])
  })

  it.each([
    ['empty filename', { '': { profile: 'PDF/A-2b', compliant: true, violations: [] } }],
    ['blank profile', { 'a.pdf': { profile: ' ', compliant: true, violations: [] } }],
    ['empty profile list', { 'a.pdf': { profile: [], compliant: true, violations: [] } }],
    [
      'contradictory fatal finding',
      {
        'a.pdf': {
          profile: 'PDF/A-2b',
          compliant: true,
          violations: [{ description: 'Missing output intent', severity: 'fatal' }],
        },
      },
    ],
    [
      'empty violation',
      { 'a.pdf': { profile: 'PDF/A-2b', compliant: false, violations: [{ description: ' ' }] } },
    ],
    [
      'long filename',
      { [`${'a'.repeat(256)}.pdf`]: { profile: 'PDF/A-2b', compliant: true, violations: [] } },
    ],
    [
      'too many documents',
      Object.fromEntries(
        Array.from({ length: 201 }, (_, i) => [
          `${i}.pdf`,
          { profile: 'PDF/A-2b', compliant: true, violations: [] },
        ]),
      ),
    ],
  ])('rejects %s rather than declaring compliance', (_, report) => {
    assert.equal(parsePdfValidationReport(JSON.stringify(report)), null)
  })

  it('preserves compliant Factur-X reports with non-fatal findings', () => {
    const source = JSON.stringify({
      'invoice.pdf': {
        profile: 'Factur-X',
        compliant: true,
        violations: [
          {
            specification: 'Factur-X',
            description: 'An optional invoice rule generated a warning',
            severity: 'warning',
          },
        ],
      },
    })
    assert.deepEqual(parsePdfValidationReport(source), [
      {
        filename: 'invoice.pdf',
        compliant: true,
        profile: 'Factur-X',
        totalViolations: 1,
        violations: [
          {
            id: 'invoice.pdf-0',
            description: 'An optional invoice rule generated a warning',
            severity: 'warning',
          },
        ],
      },
    ])
  })

  it('caps input length and retains the five-item violations display bound', () => {
    assert.equal(parsePdfValidationReport(' '.repeat(MAX_PDF_VALIDATION_SUMMARY_BYTES + 1)), null)
    const reports = parsePdfValidationReport(
      JSON.stringify({
        'report.pdf': {
          profile: 'PDF/UA-1',
          compliant: false,
          violations: Array.from({ length: 8 }, (_, i) => ({
            description: `Violation ${i}`,
            severity: 'warning',
          })),
        },
      }),
    )
    assert.equal(reports?.[0]?.totalViolations, 8)
    assert.equal(reports?.[0]?.violations.length, 5)
    assert.equal(reports?.[0]?.compliant, false)
  })

  it('refuses to read oversized blobs, and reports I/O failures as unreadable', async () => {
    const oversized = new Blob(['tiny'])
    const read = vi.fn()
    Object.defineProperties(oversized, {
      size: { value: MAX_PDF_VALIDATION_SUMMARY_BYTES + 1 },
      text: { value: read },
    })
    assert.equal(await summarisePdfValidationBlob(oversized), null)
    assert.equal(read.mock.calls.length, 0)
    const unreadable = new Blob(['{}'])
    Object.defineProperty(unreadable, 'text', {
      value: () => Promise.reject(new Error('read failed')),
    })
    assert.equal(await summarisePdfValidationBlob(unreadable), null)
  })

  it('returns a full summary for a small blob without affecting its download', async () => {
    const source = new Blob([valid()], { type: 'application/json' })
    assert.equal((await summarisePdfValidationBlob(source))?.[0]?.compliant, true)
    assert.equal(await source.text(), valid())
  })
})
