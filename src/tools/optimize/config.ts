/** Definition for the optimize Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'optimize',
  supportedGotenbergMajors: [8, 9],
  title: 'Optimize PDFs',
  group: 'PDF tools',
  summary:
    'Optimize PDF files. Gotenberg 9 uses lossless optimization; Gotenberg 8 offers an image-quality slider.',
  path: '/forms/pdfengines/optimize',
  docs: 'manipulate-pdfs/optimize-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'imageQuality',
      supportedGotenbergMajors: [8],
      label: 'Image quality',
      kind: 'number',
      min: 1,
      max: 100,
      placeholder: '80',
    },
  ],
  output: 'pdf',
}
