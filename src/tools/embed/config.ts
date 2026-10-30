/** Definition for the embed Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'embed',
  title: 'Embed attachments',
  group: 'PDF tools',
  summary: 'Attach files within a PDF.',
  path: '/forms/pdfengines/embed',
  docs: 'manipulate-pdfs/attachments',
  ...pdfFiles,
  fields: [
    { name: 'embedsMetadata', label: 'Attachment metadata JSON', kind: 'json', advanced: true },
  ],
  auxiliary: {
    name: 'embeds',
    label: 'Attachments to embed',
    description: 'Choose one or more files to embed.',
    multiple: true,
    required: true,
  },
  output: 'pdf',
}
