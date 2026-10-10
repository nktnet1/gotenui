import { describe, expect, it, vi } from 'vitest'
import {
  COLOR_THEME_STORAGE_KEY,
  persistColorThemePreference,
  readColorThemePreference,
  resolveColorTheme,
} from '#/lib/color-theme'

describe('browser color theme preference', () => {
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

  it('uses only the dedicated theme key, not a connection or credential key', () => {
    const getItem = vi.fn(() => 'dark')
    expect(readColorThemePreference({ getItem })).toBe('dark')
    expect(getItem).toHaveBeenCalledExactlyOnceWith(COLOR_THEME_STORAGE_KEY)
    const setItem = vi.fn()
    persistColorThemePreference({ setItem }, 'light')
    expect(setItem).toHaveBeenCalledExactlyOnceWith(COLOR_THEME_STORAGE_KEY, 'light')
  })

  it('survives restricted or disabled local storage', () => {
    const failingStorage = {
      getItem: () => {
        throw new Error('Not allowed')
      },
      setItem: () => {
        throw new Error('Not allowed')
      },
    }
    expect(readColorThemePreference(failingStorage)).toBe('system')
    expect(() => persistColorThemePreference(failingStorage, 'dark')).not.toThrow()
    expect(() => persistColorThemePreference(null, 'light')).not.toThrow()
  })
})
