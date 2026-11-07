/** Definition for the bookmarks-read Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'bookmarks-read',
  supportedGotenbergMajors: [8, 9],
  title: 'Read bookmarks',
  group: 'PDF tools',
  summary: 'Export bookmark trees as JSON.',
  path: '/forms/pdfengines/bookmarks/read',
  docs: 'manipulate-pdfs/read-bookmarks',
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
