import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { RemoteInputRow } from '#/lib/async-inputs'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'

const assetStages = JSON.stringify([
  { op: 'stamp-image', image: 'brand.png' },
  { op: 'attach', file: 'invoice.xml' },
])

const remoteRow = (id: number, filename: string): RemoteInputRow => ({
  id,
  url: `https://documents.example.test/${id}`,
  filename,
  field: '',
  headers: [],
})

const base = {
  localAssetNames: [] as string[],
  archivesPresent: false,
  remoteRows: [] as RemoteInputRow[],
  remoteJson: '',
  acknowledgedRedaction: false,
}

describe('PDF pipeline editor remote asset preflight', () => {
  it('accepts named remote stage assets without local uploads for PDF processing', () => {
    assert.equal(
      pdfPipelineEditorError(assetStages, {
        ...base,
        remoteRows: [remoteRow(1, 'brand.png'), remoteRow(2, 'invoice.xml')],
      }),
      null,
    )
  })

  it('shares the same preflight with conversion-time PDF processing', () => {
    const conversionStages = JSON.stringify([
      { op: 'attach', file: 'invoice.xml' },
      { op: 'remediate', profile: 'PDF/A-3b' },
    ])
    assert.equal(
      pdfPipelineEditorError(conversionStages, {
        ...base,
        remoteRows: [remoteRow(3, 'invoice.xml')],
      }),
      null,
    )
  })

  it('accepts remote filename hints from advanced JSON and combines them with local files', () => {
    assert.equal(
      pdfPipelineEditorError(assetStages, {
        ...base,
        localAssetNames: ['brand.png'],
        remoteJson: JSON.stringify([
          { url: 'https://documents.example.test/invoice', name: 'invoice.xml' },
        ]),
      }),
      null,
    )
  })

  it('does not mistake legacy remote destinations for named assets', () => {
    const missing = pdfPipelineEditorError(assetStages, {
      ...base,
      localAssetNames: ['brand.png'],
      remoteJson: JSON.stringify([
        { url: 'https://documents.example.test/invoice', name: 'invoice.xml', field: 'embedded' },
      ]),
    })
    assert.match(missing ?? '', /invoice\.xml/)
  })

  it('still rejects missing assets, invalid stages, and unacknowledged redaction', () => {
    assert.match(pdfPipelineEditorError(assetStages, base) ?? '', /brand\.png/)
    assert.match(
      pdfPipelineEditorError(assetStages, {
        ...base,
        remoteRows: [remoteRow(1, 'brand.png')],
      }) ?? '',
      /invoice\.xml/,
    )
    assert.match(
      pdfPipelineEditorError('[{"op":"rotate","angle":45}]', base) ?? '',
      /multiple of 90/,
    )
    assert.match(
      pdfPipelineEditorError(
        '[{"op":"redact","regions":[{"page":1,"x":0,"y":0,"width":4,"height":4}]}]',
        base,
      ) ?? '',
      /Confirm that redaction/,
    )
  })

  it('defers filename matching to Gotenberg when stage assets may be inside ZIPs', () => {
    assert.equal(pdfPipelineEditorError(assetStages, { ...base, archivesPresent: true }), null)
    assert.match(
      pdfPipelineEditorError('[{"op":"unknown"}]', { ...base, archivesPresent: true }) ?? '',
      /supported PDF operation/,
    )
  })

  it('gives a useful error for invalid remote JSON rather than silently ignoring hints', () => {
    assert.match(
      pdfPipelineEditorError(assetStages, { ...base, remoteJson: '{' }) ?? '',
      /Remote files must be valid JSON/,
    )
  })
})

it('rejects local stage files left behind when a stage is removed, even with archives', () => {
  for (const documentKind of ['pdf', 'office', 'single'] as const) {
    for (const archivesPresent of [false, true]) {
      assert.match(
        pdfPipelineEditorError('[{"op":"merge"}]', {
          ...base,
          documentKind,
          archivesPresent,
          localAssetNames: ['removed-insert.pdf'],
        }) ?? '',
        /Unused .*stage file: removed-insert\.pdf/,
      )
    }
  }
  assert.match(
    pdfPipelineEditorError('', {
      ...base,
      documentKind: 'office',
      localAssetNames: ['removed-insert.pdf'],
    }) ?? '',
    /Unused .*stage file: removed-insert\.pdf/,
  )
  assert.equal(
    pdfPipelineEditorError('[{"op":"attach","file":"caf\u00e9.pdf"}]', {
      ...base,
      documentKind: 'pdf',
      localAssetNames: ['cafe\u0301.pdf'],
    }),
    null,
  )
})

it('rejects raw decryption stages in conversion-time editors only', () => {
  const stages = '[{"op":"decrypt","password":"secret"}]'
  for (const documentKind of ['office', 'single'] as const) {
    assert.match(
      pdfPipelineEditorError(stages, { ...base, documentKind }) ?? '',
      /Decryption is only available for uploaded PDFs/,
    )
  }
  assert.equal(pdfPipelineEditorError(stages, { ...base, documentKind: 'pdf' }), null)
})

it('requires deterministic remote filenames when local stage assets could be shadowed', () => {
  assert.match(
    pdfPipelineEditorError('[{"op":"attach","file":"proof.txt"}]', {
      ...base,
      backendVersion: '9.10.0',
      documentKind: 'pdf',
      documentNames: ['source.pdf'],
      localAssetNames: ['proof.txt'],
      remoteRows: [remoteRow(1, '')],
    }) ?? '',
    /Specify a remote filename/,
  )
})

it('requires v9.2 to pin downloads alongside Chromium conversion pipelines', () => {
  assert.match(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...base,
      backendVersion: '9.1.0',
      documentKind: 'single',
      remoteJson: '[{"url":"https://example.test/style.css"}]',
    }) ?? '',
    /Chromium remote downloads alongside local assets require Gotenberg 9.2/,
  )
})

it('retains dynamically named downloads where no local or remote asset needs protection', () => {
  assert.equal(
    pdfPipelineEditorError('[{"op":"optimize"}]', {
      ...base,
      backendVersion: '9.10.0',
      documentKind: 'pdf',
      remoteRows: [remoteRow(1, '')],
    }),
    null,
  )
})
