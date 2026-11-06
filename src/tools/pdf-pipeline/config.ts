import type { Operation } from '#/tools/types'

/** A single ordered Gotenberg 9 PDF pipeline; Gotenberg 8 tools are unchanged. */
export const operation: Operation = {
  id: 'pdf-pipeline',
  title: 'PDF pipeline builder',
  summary: 'Combine, arrange and configure PDF processing stages in one request.',
  group: 'PDF tools',
  input: 'pdf',
  output: 'pdf',
  path: '/forms/pdf/pipe',
  docs: 'manipulate-pdfs',
  supportedGotenbergMajors: [9],
  multiple: true,
  featured: true,
  fields: [
    {
      name: 'stages',
      label: 'Ordered PDF stages',
      kind: 'json',
      defaultValue: '[{"op":"optimize"}]',
      required: true,
      customEditor: true,
    },
    {
      name: 'acknowledgedRedaction',
      label: 'I understand that redaction is permanent',
      kind: 'toggle',
    },
  ],
  auxiliary: {
    name: 'auxiliary',
    label: 'Additional stage files',
    description:
      'Upload any referenced images, insertion PDFs, attachments, invoices or signing credentials. Reference each file by its exact name in the relevant stage.',
    multiple: true,
  },
}
