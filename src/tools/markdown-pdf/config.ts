/** Definition for the markdown-pdf Gotenberg operation. */
import { chromePdf } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'markdown-pdf',
  title: 'Markdown to PDF',
  group: 'Convert',
  summary: 'Convert Markdown using a matching HTML template.',
  path: '/forms/chromium/convert/markdown',
  docs: 'convert-with-chromium/convert-markdown-to-pdf',
  input: 'markdown',
  fields: chromePdf,
  output: 'pdf',
}
