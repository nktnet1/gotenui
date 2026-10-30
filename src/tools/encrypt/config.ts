/** Definition for the encrypt Gotenberg operation. */
import { pdfFiles } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'encrypt',
  title: 'Encrypt PDFs',
  group: 'PDF tools',
  summary: 'Protect PDF content with passwords and permissions.',
  path: '/forms/pdfengines/encrypt',
  docs: 'manipulate-pdfs/encrypt-pdfs',
  ...pdfFiles,
  fields: [
    { name: 'userPassword', label: 'Open password', kind: 'password' },
    { name: 'ownerPassword', label: 'Owner password', kind: 'password' },
    {
      name: 'allowPrinting',
      label: 'Allow printing',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
    {
      name: 'allowCopying',
      label: 'Allow copying',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
    {
      name: 'allowModifying',
      label: 'Allow editing',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
    {
      name: 'allowAnnotating',
      label: 'Allow annotations',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
    {
      name: 'allowFillingForms',
      label: 'Allow filling forms',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
    {
      name: 'allowAssembling',
      label: 'Allow page assembly',
      kind: 'toggle',
      defaultValue: true,
      advanced: true,
    },
  ],
  output: 'pdf',
}
