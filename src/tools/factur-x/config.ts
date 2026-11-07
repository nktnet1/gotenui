/** Definition for the factur-x Gotenberg operation. */
import { pdfa, pdfFiles, pdfua, v9RemediationFields } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'factur-x',
  supportedGotenbergMajors: [8, 9],
  title: 'Factur-X invoices',
  group: 'PDF tools',
  summary: 'Attach compliant CII invoice XML to a PDF.',
  path: '/forms/pdfengines/factur-x',
  docs: 'manipulate-pdfs/factur-x',
  ...pdfFiles,
  fields: [
    {
      name: 'v9FacturxRepairExisting',
      label: 'Repair existing embedded invoice XML',
      kind: 'toggle',
      supportedGotenbergMajors: [9],
      description:
        'Gotenberg 9: repair a PDF already carrying Factur-X or ZUGFeRD XML without uploading new XML. The conformance level and document type below are ignored in repair mode.',
    },
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
      supportedGotenbergMajors: [8],
      label: 'Factur-X version',
      kind: 'text',
      placeholder: '1.0',
      advanced: true,
    },
    {
      ...pdfa,
      options: ['PDF/A-3a', 'PDF/A-3b', 'PDF/A-3u'],
      description:
        'Gotenberg 8 supports three PDF/A-3 variants here. Gotenberg 9 Factur-X remediation produces PDF/A-3b only.',
    },
    pdfua,
    ...v9RemediationFields,
  ],
  auxiliary: {
    name: 'facturxXml',
    label: 'Factur-X invoice XML',
    description:
      'Upload CII-format invoice XML to add or replace it. Gotenberg 9 can alternatively repair existing embedded XML using the option above.',
    accept: '.xml',
    required: false,
  },
  output: 'pdf',
}
