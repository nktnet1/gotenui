/** Definition for the metadata-read Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'metadata-read',
  supportedGotenbergMajors: [8, 9],
  title: 'Read metadata',
  group: 'PDF tools',
  summary: 'Inspect PDF metadata as JSON.',
  path: '/forms/pdfengines/metadata/read',
  docs: 'manipulate-pdfs/read-metadata',
  ...pdfFiles,
  fields: [
    {
      name: 'password',
      label: 'PDF open password',
      kind: 'password',
      supportedGotenbergMajors: [9],
      description: 'Gotenberg 9: open encrypted PDFs when reading this information.',
    },
  ],
  output: 'json',
}
