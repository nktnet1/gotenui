import assert from 'node:assert/strict'
import { describe, it, test, vi } from 'vitest'
import {
  MAX_PDF_VALIDATION_SUMMARY_BYTES,
  parsePdfValidationReport,
  summarisePdfValidationBlob,
} from '#/lib/pdf-validation-report'
import { zipFixture } from './fixtures/zip'

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
    [
      'non-PDF filename',
      { 'report.txt': { profile: 'PDF/A-2b', compliant: true, violations: [] } },
    ],
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
      arrayBuffer: { value: read },
    })
    assert.equal(await summarisePdfValidationBlob(oversized), null)
    assert.equal(read.mock.calls.length, 0)
    const unreadable = new Blob(['{}'])
    Object.defineProperty(unreadable, 'arrayBuffer', {
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

it('does not summarise a corrupt UTF-8 report as compliant', async () => {
  const report = new Blob([
    '{"a',
    Uint8Array.of(0xff),
    '.pdf":{"profile":"PDF/A-2b","compliant":true,"violations":[]}}',
  ])
  assert.equal(await summarisePdfValidationBlob(report), null)
  assert.match(await report.text(), /compliant/)
})

const pdfFile = (name: string) => new File(['%PDF-1.7\n'], name)
const reportBlob = (...names: string[]) =>
  new Blob([
    JSON.stringify(
      Object.fromEntries(
        names.map((name) => [name, { profile: 'PDF/A-2b', compliant: true, violations: [] }]),
      ),
    ),
  ])

it('requires every registered upload in the report, not just the right profile', async () => {
  const inputs = { files: [pdfFile('first.pdf'), pdfFile('second.pdf')] }
  for (const names of [
    ['first.pdf'],
    ['first.pdf', 'unrelated.pdf'],
    ['first.pdf', 'second.pdf', 'unrelated.pdf'],
  ]) {
    assert.equal(await summarisePdfValidationBlob(reportBlob(...names), ['PDF/A-2b'], inputs), null)
  }
  assert.equal(
    (await summarisePdfValidationBlob(reportBlob('second.pdf', 'first.pdf'), ['PDF/A-2b'], inputs))
      ?.length,
    2,
  )
})

it('matches NFC-normalised and numbered upload names, including occupied suffixes', async () => {
  const files = [pdfFile('cafe\u0301.pdf'), pdfFile('caf\u00e9 (2).pdf'), pdfFile('caf\u00e9.pdf')]
  assert.equal(
    (
      await summarisePdfValidationBlob(
        reportBlob('caf\u00e9.pdf', 'caf\u00e9 (2).pdf', 'caf\u00e9 (3).pdf'),
        ['PDF/A-2b'],
        { files },
      )
    )?.length,
    3,
  )
})

it('counts known ZIP PDFs and ignores non-document archive entries', async () => {
  const inputs = {
    files: [pdfFile('local.pdf')],
    archives: [
      zipFixture({
        'sub/archived.PDF': '%PDF-1.7',
        'readme.txt': 'text',
        '__MACOSX/._archived.PDF': 'metadata',
      }),
    ],
  }
  assert.equal(
    await summarisePdfValidationBlob(reportBlob('local.pdf'), ['PDF/A-2b'], inputs),
    null,
  )
  assert.equal(
    (
      await summarisePdfValidationBlob(
        reportBlob('local.pdf', 'archived.PDF'),
        ['PDF/A-2b'],
        inputs,
      )
    )?.length,
    2,
  )
})

it('checks the count rather than assuming registration order for colliding archive and upload names', async () => {
  const inputs = {
    files: [pdfFile('a.pdf'), pdfFile('a (2).pdf')],
    archives: [zipFixture({ 'a.pdf': '%PDF-1.7', 'a (2).pdf': '%PDF-1.7' })],
  }
  for (const names of [
    ['a.pdf', 'a (2).pdf', 'a (3).pdf', 'a (2) (2).pdf'],
    ['a.pdf', 'a (2).pdf', 'a (3).pdf', 'a (2) (2).pdf', 'extra.pdf'],
  ]) {
    const result = await summarisePdfValidationBlob(reportBlob(...names), ['PDF/A-2b'], inputs)
    assert.equal(result?.length ?? null, names.length === 4 ? 4 : null)
  }
})

it('checks explicitly pinned and inferred remote names in the known v9.2+ request', async () => {
  const inputs = {
    files: [pdfFile('local.pdf')],
    expectedBackendVersion: '9.10.2',
    downloadFrom: [
      { url: 'https://example.test/download', filename: 'remote.pdf' },
      { url: 'https://example.test/inferred.PDF' },
    ],
  }
  assert.equal(
    await summarisePdfValidationBlob(reportBlob('local.pdf', 'remote.pdf'), ['PDF/A-2b'], inputs),
    null,
  )
  assert.equal(
    (
      await summarisePdfValidationBlob(
        reportBlob('local.pdf', 'remote.pdf', 'inferred.PDF'),
        ['PDF/A-2b'],
        inputs,
      )
    )?.length,
    3,
  )
})

it('requires known input counts without guessing the server-selected remote filenames', async () => {
  const inputs = {
    files: [pdfFile('local.pdf'), pdfFile('other.pdf')],
    downloadFrom: [{ url: 'https://example.test/download' }],
  }
  for (const names of [
    ['local.pdf'],
    ['local.pdf', 'unrelated.pdf'],
    ['local.pdf', 'unrelated.pdf', 'resolved.pdf'],
  ]) {
    assert.equal(await summarisePdfValidationBlob(reportBlob(...names), ['PDF/A-2b'], inputs), null)
  }
  assert.equal(
    (
      await summarisePdfValidationBlob(
        reportBlob('local.pdf', 'other.pdf', 'resolved.pdf'),
        ['PDF/A-2b'],
        inputs,
      )
    )?.length,
    3,
  )
})

it('preserves the download when local archive metadata cannot be inspected', async () => {
  const blob = reportBlob('local.pdf')
  assert.equal(
    await summarisePdfValidationBlob(blob, ['PDF/A-2b'], {
      files: [pdfFile('local.pdf')],
      archives: [new File(['bad archive'], 'archive.zip')],
    }),
    null,
  )
  assert.match(await blob.text(), /local\.pdf/)
})

it('requires known filenames even when archive registration order cannot be determined', async () => {
  const inputs = {
    files: [pdfFile('a.pdf'), pdfFile('a (2).pdf')],
    archives: [zipFixture({ 'a.pdf': '%PDF-1.7', 'b.pdf': '%PDF-1.7' })],
  }
  assert.equal(
    await summarisePdfValidationBlob(
      reportBlob('a.pdf', 'a (2).pdf', 'a (3).pdf', 'unrelated.pdf'),
      ['PDF/A-2b'],
      inputs,
    ),
    null,
  )
  for (const names of [
    ['a.pdf', 'a (2).pdf', 'a (3).pdf', 'b.pdf'],
    ['a.pdf', 'a (2).pdf', 'a (2) (2).pdf', 'b.pdf'],
  ]) {
    assert.equal(
      (await summarisePdfValidationBlob(reportBlob(...names), ['PDF/A-2b'], inputs))?.length,
      4,
    )
  }
})

it('requires the original known filename without guessing its numbered duplicates', async () => {
  const inputs = {
    files: [pdfFile('a.pdf'), pdfFile('a.pdf')],
    downloadFrom: [{ url: 'https://example.test/download' }],
  }
  assert.equal(
    await summarisePdfValidationBlob(reportBlob('a (2).pdf', 'a (3).pdf'), ['PDF/A-2b'], inputs),
    null,
  )
  assert.equal(
    (
      await summarisePdfValidationBlob(
        reportBlob('a.pdf', 'a (2).pdf', 'a (3).pdf'),
        ['PDF/A-2b'],
        inputs,
      )
    )?.length,
    3,
  )
})

it('can still summarise remote-only reports with server-selected names', async () => {
  const inputs = { files: [], downloadFrom: [{ url: 'https://example.test/download' }] }
  assert.equal(
    (await summarisePdfValidationBlob(reportBlob('resolved.PDF'), ['PDF/A-2b'], inputs))?.length,
    1,
  )
})

test.each([
  { 'bad\ud800.pdf': { profile: 'PDF/A-2b', compliant: true, violations: [] } },
  {
    'report.pdf': {
      profile: 'PDF/A-2b',
      compliant: false,
      violations: [{ description: 'bad\ud800' }],
    },
  },
  {
    'report.pdf': {
      profile: 'PDF/A-2b',
      compliant: true,
      violations: [{ description: 'warning', severity: '\ud800' }],
    },
  },
])('rejects escaped malformed Unicode in validation report %j', async (report) => {
  const raw = JSON.stringify(report)
  assert.equal(parsePdfValidationReport(raw), null)
  assert.equal(await summarisePdfValidationBlob(new Blob([raw])), null)
})
