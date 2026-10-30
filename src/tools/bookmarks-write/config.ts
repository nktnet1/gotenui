/** Definition for the bookmarks-write Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'bookmarks-write',
  title: 'Write bookmarks',
  group: 'PDF tools',
  summary: 'Replace document bookmarks from JSON.',
  path: '/forms/pdfengines/bookmarks/write',
  docs: 'manipulate-pdfs/write-bookmarks',
  ...pdfFiles,
  fields: [
    {
      name: 'bookmarks',
      label: 'Bookmarks JSON',
      kind: 'json',
      required: true,
      defaultValue: '[{"title":"Chapter 1","page":1,"children":[]}]',
    },
  ],
  output: 'pdf',
}
