import { Check, Monitor, Moon, Sun } from 'lucide-react'
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
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

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

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

/** Standard vertical menu navigation, with keyboard wrapping. */
export function nextThemeMenuIndex(current: number, key: string): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return THEME_OPTIONS.length - 1
  if (key === 'ArrowDown') return (current + 1) % THEME_OPTIONS.length
  if (key === 'ArrowUp') return (current - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length
  return null
}

/** Icons and text are rendered as real menu items (native <option> cannot display SVGs). */
export function ThemeMenuOptions({
  preference,
  onSelect,
}: {
  preference: ColorThemePreference
  onSelect: (preference: ColorThemePreference) => void
}) {
  return THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={preference === value}
      tabIndex={-1}
      onClick={() => onSelect(value)}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-700 outline-none hover:bg-slate-100 focus-visible:bg-sky-100 focus-visible:text-sky-900 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:bg-sky-950 dark:focus-visible:text-sky-200"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <span className="flex-1">{label}</span>
      {preference === value && <Check aria-hidden="true" className="size-4 text-sky-600" />}
    </button>
  ))
}

/** Compact theme picker with a visible desktop label and keyboard-accessible choices. */
export function ThemeSelect() {
  const { preference, setPreference } = useColorTheme()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = THEME_OPTIONS.find((option) => option.value === preference) ?? THEME_OPTIONS[0]
  const Icon = current.icon

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const closeOnPointerOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnPointerOutside)
    document.addEventListener('focusin', closeOnFocusOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerOutside)
      document.removeEventListener('focusin', closeOnFocusOutside)
    }
  }, [open])

  function choose(next: ColorThemePreference) {
    setPreference(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const index = items.indexOf(event.target as HTMLButtonElement)
    const next = nextThemeMenuIndex(index < 0 ? 0 : index, event.key)
    if (next !== null) {
      event.preventDefault()
      items[next]?.focus()
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Appearance theme: ${current.label}`}
        title={`Appearance: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="flex h-9 w-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 text-sky-700 outline-none transition-colors hover:border-sky-400 hover:bg-sky-50 focus-visible:ring-4 focus-visible:ring-sky-100 lg:w-28 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700 dark:focus-visible:ring-sky-900"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="hidden text-xs font-semibold lg:inline">{current.label}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Appearance theme"
          onKeyDown={menuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/30"
        >
          <ThemeMenuOptions preference={preference} onSelect={choose} />
        </div>
      )}
    </div>
  )
}
