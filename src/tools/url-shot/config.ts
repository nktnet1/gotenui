/** Definition for the url-shot Gotenberg operation. */
import { screenshot, sourceUrl } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'url-shot',
  title: 'Website screenshot',
  group: 'Capture',
  summary: 'Capture a website as PNG, JPEG or WebP.',
  path: '/forms/chromium/screenshot/url',
  docs: 'convert-with-chromium/screenshot-url',
  input: 'url',
  fields: [sourceUrl, ...screenshot],
  output: 'image',
  featured: true,
}
