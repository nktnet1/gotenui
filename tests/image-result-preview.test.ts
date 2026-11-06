import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { ImageResultPreview, isPreviewableImage } from '#/components/image-result-preview'

test('raster image previews are opt-in and never embed images before opening', () => {
  const html = renderToStaticMarkup(
    createElement(ImageResultPreview, {
      url: 'blob:private-result',
      name: 'page-1.png',
    }),
  )
  assert.match(html, /Preview image/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /<img|blob:private-result/)
})

test('only verified raster media types are eligible for a browser preview', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.equal(isPreviewableImage(type), true)
  }
  for (const type of [
    undefined,
    'image/svg+xml',
    'image/gif',
    'application/zip',
    'application/pdf',
  ]) {
    assert.equal(isPreviewableImage(type), false)
  }
})
