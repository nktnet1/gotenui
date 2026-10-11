import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PdfEmbeddedDocument, PdfResultPreview } from '#/components/pdf-result-preview'

describe('browser-only PDF result preview', () => {
  it('offers an opt-in inline preview without removing download or new-tab fallback', () => {
    const html = renderToStaticMarkup(
      createElement(PdfResultPreview, { url: 'blob:example/preview-1', name: 'report.pdf' }),
    )
    expect(html).toContain('Preview PDF')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Open in new tab')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('blob:example/preview-1')
    expect(html).not.toContain('<object')
  })

  it('embeds the existing Blob as a PDF with an accessible name and fallback', () => {
    const html = renderToStaticMarkup(
      createElement(PdfEmbeddedDocument, {
        url: 'blob:example/preview-2',
        name: 'converted.pdf',
      }),
    )
    expect(html).toContain('data="blob:example/preview-2"')
    expect(html).toContain('type="application/pdf"')
    expect(html).toContain('aria-label="PDF preview: converted.pdf"')
    expect(html).toContain('cannot display the PDF inline')
    expect(html).not.toContain('<iframe')
  })
})
