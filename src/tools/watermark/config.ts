/** Definition for the watermark Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'watermark',
  title: 'Watermark PDFs',
  group: 'PDF tools',
  summary: 'Add text, an image or a PDF behind pages.',
  path: '/forms/pdfengines/watermark',
  docs: 'manipulate-pdfs/watermark-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'watermarkSource',
      label: 'Source',
      kind: 'select',
      options: ['text', 'image', 'pdf'],
      required: true,
      defaultValue: 'text',
    },
    {
      name: 'watermarkExpression',
      label: 'Text or uploaded filename',
      kind: 'text',
      placeholder: 'CONFIDENTIAL',
      required: true,
    },
    {
      name: 'watermarkPages',
      label: 'Pages',
      kind: 'text',
      placeholder: 'All pages',
      advanced: true,
    },
    {
      name: 'watermarkOptions',
      label: 'Options JSON',
      kind: 'json',
      placeholder: '{"opacity":0.25,"rotation":45}',
      advanced: true,
    },
  ],
  auxiliary: {
    name: 'watermark',
    label: 'Watermark image or PDF',
    description: 'Needed for image/PDF sources.',
    accept: 'image/*,.pdf',
  },
  output: 'pdf',
}
