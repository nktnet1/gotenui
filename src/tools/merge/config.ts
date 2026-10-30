/** Definition for the merge Gotenberg operation. */
import {
  optimizeImages,
  pdfa,
  pdfBookmarks,
  pdfFiles,
  pdfMetadata,
  pdfua,
} from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'merge',
  title: 'Merge PDFs',
  group: 'PDF tools',
  summary: 'Combine PDFs in your selected order.',
  path: '/forms/pdfengines/merge',
  docs: 'manipulate-pdfs/merge-pdfs',
  ...pdfFiles,
  fields: [
    ...optimizeImages,
    pdfa,
    pdfua,
    { name: 'autoIndexBookmarks', label: 'Keep document bookmarks', kind: 'toggle' },
    pdfBookmarks,
    pdfMetadata,
    {
      name: 'titleBookmarks',
      label: 'Add bookmarks from titles',
      kind: 'toggle',
      advanced: true,
    },
  ],
  output: 'pdf',
  featured: true,
}
