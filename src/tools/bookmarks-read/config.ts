/** Definition for the bookmarks-read Gotenberg operation. */
import { noFields, pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'bookmarks-read',
  title: 'Read bookmarks',
  group: 'PDF tools',
  summary: 'Export bookmark trees as JSON.',
  path: '/forms/pdfengines/bookmarks/read',
  docs: 'manipulate-pdfs/read-bookmarks',
  ...pdfFiles,
  fields: noFields,
  output: 'json',
}
