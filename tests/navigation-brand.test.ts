import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Brand, Sidebar } from '#/components/gotenui-app'
import { TooltipProvider } from '#/components/ui/tooltip'
import { version as appVersion } from '../package.json'

describe('sidebar branding and bookmark navigation', () => {
  it('shows the plain brand name without a decorative full stop', () => {
    const html = renderToStaticMarkup(createElement(Brand))
    expect(html).toContain('src="/gotenui-icon.svg"')
    expect(html).toContain('>Gotenui</p>')
    expect(html).not.toContain('Gotenui<span')
    expect(html).toContain(`>v${appVersion}</p>`)
    expect(html).not.toContain('GOTENBERG WORKSPACE')
  })

  it('distinguishes reading from writing PDF bookmarks with semantic icons', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(Sidebar, {
          selectedId: 'bookmarks-read',
          onSelect: vi.fn(),
          status: null,
          onSettings: vi.fn(),
          onSearch: vi.fn(),
          mobileOpen: false,
          setMobileOpen: vi.fn(),
        }),
      ),
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

  it('has contrasting light and dark surfaces throughout the sidebar', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(Sidebar, {
          selectedId: 'bookmarks-read',
          onSelect: vi.fn(),
          status: null,
          onSettings: vi.fn(),
          onSearch: vi.fn(),
          mobileOpen: false,
          setMobileOpen: vi.fn(),
        }),
      ),
    )

    const sidebar = html.match(/<aside\b[^>]*>/)?.[0] ?? ''
    expect(sidebar).toContain('bg-white')
    expect(sidebar).toContain('text-slate-900')
    expect(sidebar).toContain('dark:bg-[#0c1b2c]')
    expect(sidebar).toContain('dark:text-white')
    expect(html).toContain('tracking-tight text-slate-900 dark:text-white')

    const search = html.match(/<button[^>]*aria-label="Search tools"[^>]*>/)?.[0] ?? ''
    expect(search).toContain('bg-slate-50')
    expect(search).toContain('dark:bg-white/5')

    const selected = html.match(/<button[^>]*aria-current="page"[^>]*>/)?.[0] ?? ''
    expect(selected).toContain('bg-sky-100 text-sky-800')
    expect(selected).toContain('dark:bg-sky-500/15 dark:text-sky-300')

    expect(html).toContain('text-slate-800 dark:text-white">Gotenberg service')
    expect(html).toContain('bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5')
    expect(html).toContain('text-slate-600 transition-colors hover:bg-slate-100')
  })
})
