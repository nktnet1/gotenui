/** Definition for the rotate Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'rotate',
  title: 'Rotate PDF pages',
  group: 'PDF tools',
  summary: 'Rotate all or selected pages.',
  path: '/forms/pdfengines/rotate',
  docs: 'manipulate-pdfs/rotate-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'rotateAngle',
      label: 'Rotation',
      kind: 'select',
      options: ['90', '180', '270'],
      required: true,
      defaultValue: '90',
    },
    { name: 'rotatePages', label: 'Pages to rotate', kind: 'text', placeholder: 'All pages' },
  ],
  output: 'pdf',
}
