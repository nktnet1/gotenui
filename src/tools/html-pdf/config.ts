/** Definition for the html-pdf Gotenberg operation. */
import { chromePdf } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'html-pdf',
  title: 'HTML to PDF',
  group: 'Convert',
  summary: 'Render your HTML and optional assets.',
  path: '/forms/chromium/convert/html',
  docs: 'convert-with-chromium/convert-html-to-pdf',
  input: 'html',
  fields: chromePdf,
  output: 'pdf',
  featured: true,
}
