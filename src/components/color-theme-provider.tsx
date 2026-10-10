import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from 'react'
import { browserStorage } from '#/lib/backend-url'
import {
  persistColorThemePreference,
  type ResolvedColorTheme,
  readColorThemePreference,
  resolveColorTheme,
} from '#/lib/color-theme'

type ColorThemeContextValue = {
  theme: ResolvedColorTheme
  toggleTheme: () => void
}

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null)

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(() => readColorThemePreference(browserStorage()))
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )
  const theme = resolveColorTheme(preference, systemDark)

  useLayoutEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    setSystemDark(query.matches)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setPreference(next)
    persistColorThemePreference(browserStorage(), next)
  }

  return (
    <ColorThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ColorThemeContext.Provider>
  )
}

export function useColorTheme(): ColorThemeContextValue {
  const value = useContext(ColorThemeContext)
  if (!value) throw new Error('Color theme provider is missing.')
  return value
}
