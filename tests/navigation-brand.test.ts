import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Brand, Sidebar } from '#/components/gotenui-app'

describe('sidebar branding and bookmark navigation', () => {
  it('shows the plain brand name without a decorative full stop', () => {
    const html = renderToStaticMarkup(createElement(Brand))
    expect(html).toContain('src="/gotenui-icon.svg"')
    expect(html).toContain('>Gotenui</p>')
    expect(html).not.toContain('Gotenui<span')
    expect(html).toContain('GOTENBERG WORKSPACE')
  })

  it('distinguishes reading from writing PDF bookmarks with semantic icons', () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        selectedId: 'bookmarks-read',
        onSelect: vi.fn(),
        status: null,
        onSettings: vi.fn(),
        onSearch: vi.fn(),
        mobileOpen: false,
        setMobileOpen: vi.fn(),
      }),
    )
    expect(html).toContain('aria-label="Search tools"')
    expect(html).toContain('aria-keyshortcuts="Control+K Meta+K"')
    expect(html).not.toContain('type="search"')
    for (const [label, icon] of [
      ['Read bookmarks', 'lucide-bookmark-check'],
      ['Write bookmarks', 'lucide-bookmark-plus'],
    ]) {
      const labelPosition = html.indexOf(`>${label}</span>`)
      expect(labelPosition).toBeGreaterThan(0)
      const buttonStart = html.lastIndexOf('<button', labelPosition)
      const button = html.slice(buttonStart, labelPosition)
      expect(button).toContain(`lucide ${icon}`)
      expect(button).not.toContain('lucide-braces')
    }
  })
})
