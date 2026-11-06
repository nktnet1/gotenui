/** Definition for the flatten Gotenberg operation. */
import { noFields, pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'flatten',
  supportedGotenbergMajors: [8, 9],
  title: 'Flatten PDFs',
  group: 'PDF tools',
  summary:
    'Flatten PDFs. Gotenberg 9 flattens form fields only; Gotenberg 8 also flattens annotations.',
  path: '/forms/pdfengines/flatten',
  docs: 'manipulate-pdfs/flatten-pdfs',
  ...pdfFiles,
  fields: [
    ...noFields,
    {
      name: 'v9FlattenFormsOnly',
      label: 'I understand that Gotenberg 9 flattens form fields only, not annotations',
      kind: 'toggle',
      supportedGotenbergMajors: [9],
      description:
        'This acknowledgement is required on Gotenberg 9 to avoid silently changing the result.',
    },
  ],
  output: 'pdf',
}
