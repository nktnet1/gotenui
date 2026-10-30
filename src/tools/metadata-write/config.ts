/** Definition for the metadata-write Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'metadata-write',
  title: 'Write metadata',
  group: 'PDF tools',
  summary: 'Set author, title, keywords and more.',
  path: '/forms/pdfengines/metadata/write',
  docs: 'manipulate-pdfs/write-metadata',
  ...pdfFiles,
  fields: [
    {
      name: 'metadata',
      label: 'Metadata JSON',
      kind: 'json',
      required: true,
      defaultValue: '{"Author":"Gotenui"}',
    },
  ],
  output: 'pdf',
}
