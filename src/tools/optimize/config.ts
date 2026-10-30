/** Definition for the optimize Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'optimize',
  title: 'Optimize PDFs',
  group: 'PDF tools',
  summary: 'Reduce PDF sizes with image optimization.',
  path: '/forms/pdfengines/optimize',
  docs: 'manipulate-pdfs/optimize-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'imageQuality',
      label: 'Image quality',
      kind: 'number',
      min: 1,
      max: 100,
      placeholder: '80',
    },
  ],
  output: 'pdf',
}
