/** Definition for the stamp Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'stamp',
  title: 'Stamp PDFs',
  group: 'PDF tools',
  summary: 'Place text or artwork on top of document pages.',
  path: '/forms/pdfengines/stamp',
  docs: 'manipulate-pdfs/stamp-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'stampSource',
      label: 'Source',
      kind: 'select',
      options: ['text', 'image', 'pdf'],
      required: true,
      defaultValue: 'text',
    },
    {
      name: 'stampExpression',
      label: 'Text or uploaded filename',
      kind: 'text',
      placeholder: 'APPROVED',
      required: true,
    },
    {
      name: 'stampPages',
      label: 'Pages',
      kind: 'text',
      placeholder: 'All pages',
      advanced: true,
    },
    {
      name: 'stampOptions',
      label: 'Options JSON',
      kind: 'json',
      placeholder: '{"opacity":0.5,"rotation":0}',
      advanced: true,
    },
  ],
  auxiliary: {
    name: 'stamp',
    label: 'Stamp image or PDF',
    description: 'Needed for image/PDF sources.',
    accept: 'image/*,.pdf',
  },
  output: 'pdf',
}
