/** Definition for the metadata-read Gotenberg operation. */
import { noFields, pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'metadata-read',
  title: 'Read metadata',
  group: 'PDF tools',
  summary: 'Inspect PDF metadata as JSON.',
  path: '/forms/pdfengines/metadata/read',
  docs: 'manipulate-pdfs/read-metadata',
  ...pdfFiles,
  fields: noFields,
  output: 'json',
}
