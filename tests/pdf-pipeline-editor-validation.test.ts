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
