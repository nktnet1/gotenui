import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from 'react'
import { browserStorage } from '#/lib/backend-url'
import {
  type ColorThemePreference,
  persistColorThemePreference,
  type ResolvedColorTheme,
  readColorThemePreference,
  resolveColorTheme,
} from '#/lib/color-theme'

type ColorThemeContextValue = {
  theme: ResolvedColorTheme
  preference: ColorThemePreference
  setPreference: (preference: ColorThemePreference) => void
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

  function choosePreference(next: ColorThemePreference) {
    setPreference(next)
    persistColorThemePreference(browserStorage(), next)
  }

  return (
    <ColorThemeContext.Provider value={{ theme, preference, setPreference: choosePreference }}>
      {children}
    </ColorThemeContext.Provider>
  )
}

export function useColorTheme(): ColorThemeContextValue {
  const value = useContext(ColorThemeContext)
  if (!value) throw new Error('Color theme provider is missing.')
  return value
}

/** Native select makes System, Light, and Dark available to mouse and keyboard users. */
export function ThemeSelect() {
  const { preference, setPreference } = useColorTheme()
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor
  return (
    <div className="relative">
      <label className="sr-only" htmlFor="gotenui-theme-preference">
        Appearance theme
      </label>
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-sky-600 dark:text-sky-400"
      />
      <select
        id="gotenui-theme-preference"
        value={preference}
        onChange={(event) => setPreference(event.target.value as ColorThemePreference)}
        className="h-8 w-[126px] cursor-pointer appearance-none rounded-lg border border-slate-300 bg-slate-50 pr-7 pl-8 text-xs font-semibold text-slate-800 outline-none transition-colors hover:border-sky-300 focus-visible:border-sky-500 focus-visible:ring-4 focus-visible:ring-sky-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600 dark:focus-visible:ring-sky-900"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
      />
    </div>
  )
}
