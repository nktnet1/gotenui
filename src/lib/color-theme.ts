/** Browser-only presentation preference. Never includes connection or document data. */
export const COLOR_THEME_STORAGE_KEY = 'gotenui.color-theme.v1'

export type ColorThemePreference = 'system' | 'light' | 'dark'
export type ResolvedColorTheme = 'light' | 'dark'

export function readColorThemePreference(
  storage: Pick<Storage, 'getItem'> | null,
): ColorThemePreference {
  try {
    const value = storage?.getItem(COLOR_THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function persistColorThemePreference(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  preference: ColorThemePreference,
): void {
  try {
    if (preference === 'system') storage?.removeItem(COLOR_THEME_STORAGE_KEY)
    else storage?.setItem(COLOR_THEME_STORAGE_KEY, preference)
  } catch {
    // Private browsing or disabled localStorage must not prevent theme changes.
  }
}

export function resolveColorTheme(
  preference: ColorThemePreference,
  systemPrefersDark: boolean,
): ResolvedColorTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
}
