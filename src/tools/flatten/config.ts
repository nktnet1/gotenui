/** Definition for the flatten Gotenberg operation. */
import { noFields, pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'flatten',
  title: 'Flatten PDFs',
  group: 'PDF tools',
  summary: 'Flatten interactive fields and annotations.',
  path: '/forms/pdfengines/flatten',
  docs: 'manipulate-pdfs/flatten-pdfs',
  ...pdfFiles,
  fields: noFields,
  output: 'pdf',
}
