/** Definition for the pdfa Gotenberg operation. */
import { pdfa, pdfFiles, pdfua, v9PdfaProfile, v9PdfuaProfile } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'pdfa',
  supportedGotenbergMajors: [8, 9],
  title: 'PDF/A & PDF/UA',
  group: 'PDF tools',
  summary: 'Make PDFs archival or accessibility compliant.',
  path: '/forms/pdfengines/convert',
  docs: 'manipulate-pdfs/pdfa-pdfua',
  ...pdfFiles,
  fields: [
    { ...pdfa, advanced: false, supportedGotenbergMajors: [8] },
    { ...pdfua, advanced: false, supportedGotenbergMajors: [8] },
    { ...v9PdfaProfile, advanced: false },
    { ...v9PdfuaProfile, advanced: false },
    {
      name: 'v9Language',
      label: 'Document language',
      kind: 'text',
      placeholder: 'en-AU',
      description: 'Optional document language for PDF/A or PDF/UA remediation.',
      supportedGotenbergMajors: [9],
      advanced: true,
    },
    {
      name: 'v9Aggressive',
      label: 'Allow appearance-changing repairs',
      kind: 'toggle',
      description: 'Permits remediation changes that may alter how the pages look.',
      supportedGotenbergMajors: [9],
      advanced: true,
    },
    {
      name: 'v9FigureAltText',
      label: 'Fallback figure alt text',
      kind: 'text',
      description: 'Text assigned to figures missing alternative text.',
      supportedGotenbergMajors: [9],
      advanced: true,
    },
  ],
  output: 'pdf',
}
