/** Definition for the pdfa Gotenberg operation. */
import { pdfa, pdfFiles, pdfua } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'pdfa',
  title: 'PDF/A & PDF/UA',
  group: 'PDF tools',
  summary: 'Make PDFs archival or accessibility compliant.',
  path: '/forms/pdfengines/convert',
  docs: 'manipulate-pdfs/pdfa-pdfua',
  ...pdfFiles,
  fields: [
    { ...pdfa, advanced: false },
    { ...pdfua, advanced: false },
  ],
  output: 'pdf',
}
