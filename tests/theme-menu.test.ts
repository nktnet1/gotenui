import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { nextThemeMenuIndex, ThemeMenuOptions } from '#/components/color-theme-provider'

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
