/** Definition for the url-pdf Gotenberg operation. */
import { chromePdf, sourceUrl } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'url-pdf',
  title: 'Website to PDF',
  group: 'Convert',
  summary: 'Turn any public web page into a paginated PDF.',
  path: '/forms/chromium/convert/url',
  docs: 'convert-with-chromium/convert-url-to-pdf',
  input: 'url',
  fields: [sourceUrl, ...chromePdf],
  output: 'pdf',
  featured: true,
}
