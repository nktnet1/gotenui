/** Definition for the markdown-shot Gotenberg operation. */
import { screenshot } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'markdown-shot',
  title: 'Markdown screenshot',
  group: 'Capture',
  summary: 'Capture a Markdown document as an image.',
  path: '/forms/chromium/screenshot/markdown',
  docs: 'convert-with-chromium/screenshot-markdown',
  input: 'markdown',
  fields: screenshot,
  output: 'image',
}
