/** Definition for the html-shot Gotenberg operation. */
import { screenshot } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'html-shot',
  title: 'HTML screenshot',
  group: 'Capture',
  summary: 'Capture rendered HTML at any viewport size.',
  path: '/forms/chromium/screenshot/html',
  docs: 'convert-with-chromium/screenshot-html',
  input: 'html',
  fields: screenshot,
  output: 'image',
}
