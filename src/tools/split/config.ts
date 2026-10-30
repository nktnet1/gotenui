/** Definition for the split Gotenberg operation. */
import { optimizeImages, pdfa, pdfFiles, pdfua } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'split',
  title: 'Split PDFs',
  group: 'PDF tools',
  summary: 'Extract page ranges or split into intervals.',
  path: '/forms/pdfengines/split',
  docs: 'manipulate-pdfs/split-pdfs',
  ...pdfFiles,
  fields: [
    {
      name: 'splitMode',
      label: 'Split mode',
      kind: 'select',
      options: ['pages', 'intervals'],
      defaultValue: 'pages',
      required: true,
    },
    {
      name: 'splitSpan',
      label: 'Page range or interval',
      kind: 'text',
      placeholder: '1-3,5 or 2',
      required: true,
    },
    {
      name: 'splitUnify',
      label: 'Unify extracted ranges',
      kind: 'toggle',
      when: { name: 'splitMode', equals: 'pages' },
    },
    ...optimizeImages,
    pdfa,
    pdfua,
  ],
  output: 'zip',
}
