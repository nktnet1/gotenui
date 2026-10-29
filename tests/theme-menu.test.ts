import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ColorThemeProvider,
  nextThemeMenuIndex,
  ThemeMenuOptions,
  ThemeSelect,
} from '#/components/color-theme-provider'
import { buttonVariants } from '#/components/ui/button'
import { TooltipProvider } from '#/components/ui/tooltip'

describe('icon-and-label appearance menu', () => {
  it('renders accessible checked choices with the corresponding icons and visible text', () => {
    const html = renderToStaticMarkup(
      createElement(ThemeMenuOptions, { preference: 'system', onSelect: vi.fn() }),
    )
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(3)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('lucide-monitor')
    expect(html).toContain('lucide-sun')
    expect(html).toContain('lucide-moon')
    expect(html).toContain('>System</span>')
    expect(html).toContain('>Light</span>')
    expect(html).toContain('>Dark</span>')
  })

  it('honours the currently saved mode in the dropdown', () => {
    for (const preference of ['system', 'light', 'dark'] as const) {
      const html = renderToStaticMarkup(
        createElement(ThemeMenuOptions, { preference, onSelect: vi.fn() }),
      )
      expect(html).toContain('aria-checked="true"')
      expect(html.match(/lucide-check/g)).toHaveLength(1)
    }
  })

  it('shows the selected theme label alongside its icon at desktop widths', () => {
    const html = renderToStaticMarkup(
      createElement(
        ColorThemeProvider,
        null,
        createElement(TooltipProvider, null, createElement(ThemeSelect)),
      ),
    )
    expect(html).toContain('aria-label="Appearance theme: System"')
    expect(html).toContain('lucide-monitor')
    expect(html).toContain('lg:w-28')
    expect(html).toContain('lg:inline">System</span>')
  })

  it('matches the height of the Diagnostics and Settings buttons', () => {
    const html = renderToStaticMarkup(
      createElement(
        ColorThemeProvider,
        null,
        createElement(TooltipProvider, null, createElement(ThemeSelect)),
      ),
    )
    const trigger = html.match(/<button[^>]*aria-label="Appearance theme: System"[^>]*>/)?.[0] ?? ''
    const smallButtonHeight = buttonVariants({ variant: 'outline', size: 'sm' }).match(
      /\bh-\d+\b/,
    )?.[0]

    expect(smallButtonHeight).toBe('h-8')
    expect(trigger).toContain(smallButtonHeight)
  })

  it('supports ArrowUp/ArrowDown wrapping and Home/End navigation', () => {
    expect(nextThemeMenuIndex(0, 'ArrowDown')).toBe(1)
    expect(nextThemeMenuIndex(2, 'ArrowDown')).toBe(0)
    expect(nextThemeMenuIndex(0, 'ArrowUp')).toBe(2)
    expect(nextThemeMenuIndex(2, 'ArrowUp')).toBe(1)
    expect(nextThemeMenuIndex(1, 'Home')).toBe(0)
    expect(nextThemeMenuIndex(0, 'End')).toBe(2)
    expect(nextThemeMenuIndex(0, 'Tab')).toBeNull()
  })
})
