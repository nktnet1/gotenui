import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorThemeProvider, ThemeSelect } from '#/components/color-theme-provider'
import {
  COLOR_THEME_STORAGE_KEY,
  persistColorThemePreference,
  readColorThemePreference,
  resolveColorTheme,
} from '#/lib/color-theme'

describe('browser color theme preference', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows only the System icon in the collapsed theme menu', () => {
    const html = renderToStaticMarkup(
      createElement(ColorThemeProvider, null, createElement(ThemeSelect)),
    )
    expect(html).toContain('Appearance theme')
    expect(html).toContain('aria-label="Appearance theme: System"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('lucide-monitor')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('>System</')
    expect(html).not.toContain('lucide-chevron-down')
    expect(html).toContain('aria-hidden="true"')
  })

  it.each([
    ['light', 'lucide-sun'],
    ['dark', 'lucide-moon'],
  ] as const)('uses the correct icon when %s is selected', (saved, icon) => {
    vi.stubGlobal('window', { localStorage: { getItem: () => saved } })
    const html = renderToStaticMarkup(
      createElement(ColorThemeProvider, null, createElement(ThemeSelect)),
    )
    expect(html).toContain(`lucide ${icon}`)
    expect(html).toContain(`aria-label="Appearance theme: ${saved === 'dark' ? 'Dark' : 'Light'}"`)
  })

  it('follows system settings when no preference is saved', () => {
    expect(readColorThemePreference(null)).toBe('system')
    expect(resolveColorTheme('system', false)).toBe('light')
    expect(resolveColorTheme('system', true)).toBe('dark')
  })

  it('honors light or dark preferences regardless of system changes', () => {
    for (const preference of ['light', 'dark'] as const) {
      expect(readColorThemePreference({ getItem: () => preference })).toBe(preference)
      expect(resolveColorTheme(preference, false)).toBe(preference)
      expect(resolveColorTheme(preference, true)).toBe(preference)
    }
  })

  it('ignores unrecognized or invalid saved settings', () => {
    expect(readColorThemePreference({ getItem: () => 'auto' })).toBe('system')
    expect(readColorThemePreference({ getItem: () => 'javascript:invalid' })).toBe('system')
  })

  it('removes the saved override when System is selected again', () => {
    const setItem = vi.fn()
    const removeItem = vi.fn()
    persistColorThemePreference({ setItem, removeItem }, 'system')
    expect(removeItem).toHaveBeenCalledExactlyOnceWith(COLOR_THEME_STORAGE_KEY)
    expect(setItem).not.toHaveBeenCalled()
    expect(readColorThemePreference({ getItem: () => null })).toBe('system')
  })

  it('preserves the dedicated theme key and existing saved Light/Dark choices', () => {
    const getItem = vi.fn(() => 'dark')
    expect(readColorThemePreference({ getItem })).toBe('dark')
    expect(getItem).toHaveBeenCalledExactlyOnceWith(COLOR_THEME_STORAGE_KEY)
    const setItem = vi.fn()
    const removeItem = vi.fn()
    persistColorThemePreference({ setItem, removeItem }, 'light')
    expect(setItem).toHaveBeenCalledExactlyOnceWith(COLOR_THEME_STORAGE_KEY, 'light')
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('survives restricted or disabled local storage', () => {
    const failingStorage = {
      getItem: () => {
        throw new Error('Not allowed')
      },
      setItem: () => {
        throw new Error('Not allowed')
      },
      removeItem: () => {
        throw new Error('Not allowed')
      },
    }
    expect(readColorThemePreference(failingStorage)).toBe('system')
    expect(() => persistColorThemePreference(failingStorage, 'dark')).not.toThrow()
    expect(() => persistColorThemePreference(failingStorage, 'system')).not.toThrow()
    expect(() => persistColorThemePreference(null, 'light')).not.toThrow()
  })
})
