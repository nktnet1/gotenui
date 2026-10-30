/** Definition for the factur-x Gotenberg operation. */
import { pdfa, pdfFiles, pdfua } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'factur-x',
  title: 'Factur-X invoices',
  group: 'PDF tools',
  summary: 'Attach compliant CII invoice XML to a PDF.',
  path: '/forms/pdfengines/factur-x',
  docs: 'manipulate-pdfs/factur-x',
  ...pdfFiles,
  fields: [
    {
      name: 'facturxConformanceLevel',
      label: 'Conformance level',
      kind: 'select',
      options: ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'],
      defaultValue: 'EN 16931',
      required: true,
    },
    {
      name: 'facturxDocumentType',
      label: 'Document type',
      kind: 'select',
      options: ['INVOICE', 'ORDER', 'ORDER_RESPONSE', 'ORDER_CHANGE'],
      advanced: true,
    },
    {
      name: 'facturxVersion',
      label: 'Factur-X version',
      kind: 'text',
      placeholder: '1.0',
      advanced: true,
    },
    { ...pdfa, options: ['PDF/A-3a', 'PDF/A-3b', 'PDF/A-3u'] },
    pdfua,
  ],
  auxiliary: {
    name: 'facturxXml',
    label: 'Factur-X invoice XML',
    description: 'Upload CII-format invoice XML.',
    accept: '.xml',
    required: true,
  },
  output: 'pdf',
}
