import {
  Activity,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers3,
  Menu,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BrowserBatchQueuePanel } from '#/components/browser-batch-queue'
import { ThemeSelect } from '#/components/color-theme-provider'
import { ConnectionManager } from '#/components/connection-manager'
import { DiagnosticsDialog } from '#/components/diagnostics-dialog'
import { operationIcon } from '#/components/operation-icons'
import { OperationSearchDialog } from '#/components/operation-search-dialog'
import { ToolsHome } from '#/components/tools-home'
import { Button } from '#/components/ui/button'
import { ButtonTooltip } from '#/components/ui/button-tooltip'
import { useModalFocus } from '#/components/use-modal-focus'
import { appVersionLabel } from '#/lib/app-version'
import { browserStorage } from '#/lib/backend-url'
import { BrowserBatchQueue } from '#/lib/browser-batch-queue'
import { DEFAULT_BACKEND_URL } from '#/lib/config'
import {
  type BrowserConnection,
  type ConnectionChoice,
  DEFAULT_CONNECTION_ID,
  fetchConnectionSettings,
  loadConnections,
  type ManagedConnection,
  makeBrowserAuthorization,
  type SavedConnections,
  saveConnections,
  type UiFeatures,
} from '#/lib/connection-profiles'
import { getGotenbergStatus, type ServerStatus } from '#/lib/gotenberg-client'
import { unavailableOperationReason, versionAtLeast } from '#/lib/operation-availability'
import { isSearchShortcut } from '#/lib/operation-search'
import { cn } from '#/lib/utils'
import { GROUPS, OPERATION_BY_ID, OPERATIONS, type Operation } from '#/tools/registry'
import { Workbench } from '#/tools/shared/tool-form'
import type { Job } from '#/tools/shared/tool-jobs'
import { version as appVersion } from '../../package.json'

export { FieldControl } from '#/tools/shared/tool-fields'

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-lg shadow-sky-950/15">
        <img src="/gotenui-icon.svg" alt="" className="size-full" />
      </div>
      {!compact && (
        <div>
          <p className="text-[19px] font-extrabold tracking-tight text-slate-900 dark:text-white">
            Gotenui
          </p>
          <p className="mt-[-2px] text-[10px] font-medium tracking-[.13em] text-slate-500 dark:text-slate-400">
            {appVersionLabel(appVersion, import.meta.env.PUBLIC_GOTENUI_VERCEL_COMMIT_SHA)}
          </p>
        </div>
      )}
    </div>
  )
}

function ConnectionDialog({
  browserProfiles,
  managedProfiles,
  selected,
  onApply,
  onUpsert,
  onRemove,
  onClose,
}: {
  browserProfiles: BrowserConnection[]
  managedProfiles: ManagedConnection[]
  selected: string
  onApply: (id: string, username: string, secret: string) => void
  onUpsert: (profile: BrowserConnection, username: string, secret: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const dialogRef = useModalFocus(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-5 pt-[9vh]">
      <button
        type="button"
        aria-label="Close connection settings"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="connection-heading"
        className="relative w-full max-w-[550px] rounded-2xl bg-white dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100 shadow-2xl sm:p-8"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="connection-heading" className="text-lg font-extrabold tracking-tight">
              Connection settings
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Switch between browser and server-managed connections.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>
        <ConnectionManager
          browserProfiles={browserProfiles}
          managedProfiles={managedProfiles}
          selected={selected}
          onApply={onApply}
          onUpsert={onUpsert}
          onRemove={onRemove}
        />
      </div>
    </div>
  )
}

function Sidebar({
  selectedId,
  onSelect,
  status,
  onSettings,
  onSearch,
  mobileOpen,
  setMobileOpen,
}: {
  selectedId: string
  onSelect: (id: string) => void
  status: ServerStatus | null
  onSettings: () => void
  onSearch: () => void
  mobileOpen: boolean
  setMobileOpen: (state: boolean) => void
}) {
  const navRef = useModalFocus<HTMLElement>(() => setMobileOpen(false), mobileOpen)
  useEffect(() => {
    if (!mobileOpen) return
    // The drawer stops being modal once the desktop sidebar breakpoint is reached.
    const desktop = window.matchMedia('(min-width: 64rem)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [mobileOpen, setMobileOpen])
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          aria-hidden="true"
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-slate-950/70 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: The sidebar becomes a modal dialog only when mobile navigation is open. */}
      <aside
        id="gotenui-navigation"
        ref={navRef}
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        tabIndex={mobileOpen ? -1 : undefined}
        aria-label={mobileOpen ? 'Navigation menu' : undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col border-r border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-900/5 transition-transform dark:border-white/10 dark:bg-[#0c1b2c] dark:text-white dark:shadow-2xl dark:shadow-black/30 lg:translate-x-0',
          mobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-6 dark:border-white/10">
          <button
            type="button"
            aria-label="Go to all tools"
            aria-current={selectedId === 'home' ? 'page' : undefined}
            onClick={() => {
              onSelect('home')
              setMobileOpen(false)
            }}
            className="cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <Brand />
          </button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Close menu"
            className="text-slate-600 dark:text-slate-300 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <PanelLeftClose className="size-5" />
          </Button>
        </div>
        <div className="px-4 pt-5">
          <button
            type="button"
            aria-label="Search tools"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={onSearch}
            className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-600 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:border-sky-500/50 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1">Search tools...</span>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium dark:border-white/10 dark:bg-white/5">
              Ctrl K
            </kbd>
          </button>
        </div>
        <nav
          className="nav-scroll mt-5 flex-1 overflow-y-auto px-3 pb-6"
          aria-label="Gotenberg operations"
        >
          {GROUPS.map((group) => {
            const items = OPERATIONS.filter((operation) => operation.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="mb-5">
                <p className="mb-2 px-3 text-[10px] font-extrabold tracking-[.16em] text-slate-500 dark:text-slate-400 uppercase">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map((operation) => {
                    const Icon = operationIcon(operation.id)
                    const active = selectedId === operation.id
                    const unavailable = unavailableOperationReason(status, operation)
                    return (
                      <ButtonTooltip
                        key={operation.id}
                        description={unavailable}
                        disabled={Boolean(unavailable)}
                        wrapperClassName="block w-full"
                      >
                        <button
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          disabled={Boolean(unavailable)}
                          onClick={() => {
                            onSelect(operation.id)
                            setMobileOpen(false)
                          }}
                          className={cn(
                            'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-[10px] text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500',
                            unavailable
                              ? 'pointer-events-none cursor-not-allowed text-slate-400 dark:text-slate-600'
                              : active
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/7 dark:hover:text-white',
                          )}
                        >
                          <Icon
                            className={cn(
                              'size-4 shrink-0',
                              active
                                ? 'text-sky-600 dark:text-sky-400'
                                : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-300',
                            )}
                          />
                          <span className="flex-1 truncate">{operation.title}</span>
                          {unavailable ? (
                            <span className="text-[9px] text-amber-700 dark:text-amber-300">
                              N/A
                            </span>
                          ) : (
                            active && (
                              <span className="size-1.5 rounded-full bg-sky-600 dark:bg-sky-400" />
                            )
                          )}
                        </button>
                      </ButtonTooltip>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="border-t border-slate-200 px-4 py-4 dark:border-white/10">
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5">
            <span
              className={cn(
                'relative flex size-2 shrink-0 rounded-full',
                status?.online
                  ? 'bg-emerald-500 dark:bg-emerald-400'
                  : 'bg-amber-500 dark:bg-amber-400',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-white">
                Gotenberg service
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {status
                  ? status.online
                    ? `Online · ${status.version}`
                    : 'Not responding'
                  : 'Checking connection...'}
              </p>
            </div>
            <Activity className="size-4 text-slate-500 dark:text-slate-400" />
          </div>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:bg-white/7 dark:hover:text-white"
            onClick={onSettings}
          >
            <Settings2 className="size-4" />
            Connection settings
          </button>
        </div>
      </aside>
    </>
  )
}

function Workspace({
  connection,
  connectionName,
  selectedConnection,
  connectionEpoch,
  browserProfiles,
  managedProfiles,
  features,
  onApply,
  onUpsert,
  onRemove,
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
  connection: ConnectionChoice
  connectionName: string
  selectedConnection: string
  connectionEpoch: number
  browserProfiles: BrowserConnection[]
  managedProfiles: ManagedConnection[]
  features: UiFeatures
  onApply: (id: string, username: string, secret: string) => void
  onUpsert: (profile: BrowserConnection, username: string, secret: string) => void
  onRemove: (id: string) => void
}) {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [recent, setRecent] = useState<Job[]>([])
  const [batchQueue] = useState(
    () =>
      new BrowserBatchQueue(undefined, (job) => {
        const { name, size } = job
        if (name && size !== undefined) {
          setRecent((items) =>
            [
              {
                id: job.id,
                operation: job.operation,
                name,
                size,
                elapsed: job.elapsed ?? 0,
                trace: job.trace,
              },
              ...items,
            ].slice(0, 6),
          )
        }
      }),
  )
  const queueMounts = useRef(0)
  useEffect(() => {
    queueMounts.current++
    return () => {
      queueMounts.current--
      // React StrictMode replays effects during development. Dispose only on real unmount.
      queueMicrotask(() => {
        if (queueMounts.current === 0) batchQueue.dispose()
      })
    }
  }, [batchQueue])
  const [mobileOpen, setMobileOpen] = useState(false)
  const operation = OPERATION_BY_ID.get(selectedId) ?? (OPERATIONS[0] as Operation)
  useEffect(() => {
    document.title = `${selectedId === 'home' ? 'All tools' : operation.title} · Gotenui`
  }, [selectedId, operation.title])
  const Icon = operationIcon(operation.id)
  const unavailableReason = unavailableOperationReason(status, operation)
  const supportsOptimization = !status?.online || versionAtLeast(status.version, 36) !== false
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const headerSearchRef = useRef<HTMLButtonElement>(null)
  const searchOpenedFromDrawer = useRef(false)
  const openSearch = useCallback(() => {
    searchOpenedFromDrawer.current = mobileOpen
    setMobileOpen(false)
    setSearchOpen(true)
  }, [mobileOpen])
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    if (searchOpenedFromDrawer.current) {
      searchOpenedFromDrawer.current = false
      // The drawer's search trigger is hidden after closing it. Return keyboard
      // focus to the visible mobile-header trigger instead.
      requestAnimationFrame(() => headerSearchRef.current?.focus())
    }
  }, [])
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event) || settingsOpen || diagnosticsOpen) return
      event.preventDefault()
      if (!searchOpen) openSearch()
    }
    document.addEventListener('keydown', handleSearchShortcut)
    return () => document.removeEventListener('keydown', handleSearchShortcut)
  }, [settingsOpen, diagnosticsOpen, openSearch, searchOpen])
  const statusAbort = useRef<AbortController | null>(null)
  const refreshStatus = useCallback(
    async (notify = false) => {
      statusAbort.current?.abort()
      const controller = new AbortController()
      statusAbort.current = controller
      setStatusLoading(true)
      const timeout = window.setTimeout(() => controller.abort(), 7_000)
      try {
        const result = await getGotenbergStatus(connection, controller.signal)
        if (!controller.signal.aborted) {
          setStatus(result)
          if (notify) {
            if (result.online) toast.success('Gotenberg status refreshed - service online.')
            else toast.error('Gotenberg status refreshed - service unavailable.')
          }
        }
      } catch {
        if (statusAbort.current === controller) {
          setStatus({
            online: false,
            version: 'Unavailable',
            modules: [],
            error: 'Connection test timed out.',
          })
          if (notify) toast.error('Gotenberg status refresh timed out.')
        }
      } finally {
        window.clearTimeout(timeout)
        if (statusAbort.current === controller) {
          statusAbort.current = null
          setStatusLoading(false)
        }
      }
    },
    [connection],
  )
  useEffect(() => {
    setStatus(null)
    void refreshStatus()
    const timer = window.setInterval(() => {
      // An automatic poll must not cancel a manually requested refresh and its toast.
      if (!statusAbort.current) void refreshStatus()
    }, 30_000)
    return () => {
      window.clearInterval(timer)
      statusAbort.current?.abort()
      statusAbort.current = null
    }
  }, [refreshStatus])
  const applyConnection = (id: string, username: string, secret: string) => {
    onApply(id, username, secret)
    setSettingsOpen(false)
  }
  const upsertConnection = (profile: BrowserConnection, username: string, secret: string) => {
    onUpsert(profile, username, secret)
    setSettingsOpen(false)
  }
  return (
    <div className="min-h-screen bg-[#f6f8fb] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        selectedId={selectedId}
        onSelect={onSelect}
        status={status}
        onSettings={() => {
          setMobileOpen(false)
          setSettingsOpen(true)
        }}
        onSearch={openSearch}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="min-h-screen lg:pl-[270px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 px-3 backdrop-blur-xl sm:px-5 md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open menu"
              aria-controls="gotenui-navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              ref={headerSearchRef}
              aria-label="Search tools"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={openSearch}
            >
              <Search className="size-5" />
            </Button>
            <span className="hidden truncate text-xs font-semibold text-slate-500 dark:text-slate-400 sm:inline">
              Workspace
            </span>
            <span className="hidden text-slate-300 sm:inline">/</span>
            <span className="hidden truncate text-xs font-bold text-slate-900 dark:text-slate-100 sm:inline">
              {selectedId === 'home' ? 'All tools' : operation.group}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2.5">
            <ButtonTooltip
              description="Recheck the selected Gotenberg connection's health, version, and modules"
              disabled={statusLoading}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Refresh service status"
                onClick={() => void refreshStatus(true)}
                disabled={statusLoading}
              >
                <RefreshCw className={cn('size-4', statusLoading && 'animate-spin')} />
              </Button>
            </ButtonTooltip>
            <span className="mx-1 hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
            <ThemeSelect />
            <ButtonTooltip description="Check the selected Gotenberg instance's health and available diagnostics">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDiagnosticsOpen(true)}
                aria-label="Open diagnostics"
              >
                <Activity className="size-4" />
                <span className="hidden md:inline">Diagnostics</span>
              </Button>
            </ButtonTooltip>
            <ButtonTooltip description={connectionName}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-4" />
                <span className="hidden max-w-44 truncate md:inline">{connectionName}</span>
                <span className="hidden sm:inline md:hidden">Settings</span>
              </Button>
            </ButtonTooltip>
          </div>
        </header>
        <main className="mx-auto max-w-[1390px] px-5 pt-8 pb-14 md:px-9 md:pt-10">
          {selectedId === 'home' ? (
            <ToolsHome status={status} onSelect={onSelect} onSearch={openSearch} />
          ) : (
            <>
              <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-sky-100 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
                      <Icon className="size-6" />
                    </div>
                    <h1 className="text-[29px] font-extrabold tracking-[-.04em] text-slate-950 dark:text-white sm:text-[36px]">
                      {operation.title}
                    </h1>
                  </div>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {operation.summary}
                  </p>
                </div>
                <a
                  href="https://gotenberg.dev/docs/getting-started/routes"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-xs font-bold text-slate-600 dark:text-slate-300 shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <FileText className="size-4" />
                  API reference
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
              <div className="mb-7 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Connection
                    </span>
                    <Activity className="size-4 text-slate-400" />
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-slate-100">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        status?.online ? 'bg-emerald-500' : 'bg-amber-500',
                      )}
                    />
                    {status?.online ? 'Operational' : statusLoading ? 'Checking' : 'Unavailable'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Gotenberg version
                    </span>
                    <Layers3 className="size-4 text-slate-400" />
                  </div>
                  <p className="mt-2 truncate text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {status?.version ?? '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Modules healthy
                    </span>
                    <CheckCircle2 className="size-4 text-slate-400" />
                  </div>
                  <p className="mt-2 text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {status?.modules.length
                      ? `${status.modules.filter((module) => module.status === 'up').length} / ${status.modules.length}`
                      : '—'}
                  </p>
                </div>
              </div>
              {status?.error && (
                <div
                  role="status"
                  className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-3"
                >
                  <p className="max-w-3xl text-xs leading-5 text-amber-900 dark:text-amber-200">
                    {status.error}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Manage connections
                  </Button>
                </div>
              )}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <p className="mr-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Quick access
                </p>
                {OPERATIONS.filter((item) => item.featured).map((item) => {
                  const unavailable = unavailableOperationReason(status, item)
                  return (
                    <ButtonTooltip
                      key={item.id}
                      description={unavailable}
                      disabled={Boolean(unavailable)}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        disabled={Boolean(unavailable)}
                        className={cn(
                          'cursor-pointer rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
                          selectedId === item.id
                            ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-sky-200 dark:hover:border-sky-700 hover:text-sky-700 dark:hover:text-sky-300',
                        )}
                      >
                        {item.title}
                      </button>
                    </ButtonTooltip>
                  )
                })}
              </div>
              <Workbench
                key={`${operation.id}:${selectedConnection}:${connectionEpoch}`}
                operation={operation}
                unavailableReason={unavailableReason}
                supportsOptimization={supportsOptimization}
                backendVersion={status?.online ? status.version : undefined}
                recent={recent}
                onCompleted={(job) => setRecent((items) => [job, ...items].slice(0, 6))}
                connection={connection}
                batchQueue={batchQueue}
              />
            </>
          )}
          <BrowserBatchQueuePanel queue={batchQueue} />
        </main>
      </div>
      {searchOpen && (
        <OperationSearchDialog
          unavailableReason={(item) => unavailableOperationReason(status, item)}
          onClose={closeSearch}
          onSelect={(id) => {
            onSelect(id)
            closeSearch()
          }}
        />
      )}
      {diagnosticsOpen && (
        <DiagnosticsDialog
          connection={connection}
          connectionName={connectionName}
          onClose={() => setDiagnosticsOpen(false)}
          showDebug={features.showDebug}
          showMetrics={features.showMetrics}
        />
      )}
      {settingsOpen && (
        <ConnectionDialog
          browserProfiles={browserProfiles}
          managedProfiles={managedProfiles}
          selected={selectedConnection}
          onApply={applyConnection}
          onUpsert={upsertConnection}
          onRemove={onRemove}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function GotenuiApp({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<SavedConnections>(() =>
    loadConnections(null, DEFAULT_BACKEND_URL),
  )
  const [managed, setManaged] = useState<ManagedConnection[]>([])
  const [features, setFeatures] = useState<UiFeatures>({ showDebug: false, showMetrics: false })
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  // Ephemeral credentials: intentionally never serialized, cached or placed in URLs.
  const [credentials, setCredentials] = useState({ username: '', secret: '' })
  useEffect(() => {
    const loaded = loadConnections(browserStorage(), DEFAULT_BACKEND_URL)
    setSaved(loaded)
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
    void fetchConnectionSettings(signal)
      .then(({ connections: profiles, features: options }) => {
        setManaged(profiles)
        setFeatures(options)
        if (
          loaded.selected.startsWith('server:') &&
          !profiles.some((profile) => `server:${profile.id}` === loaded.selected)
        ) {
          const updated = { ...loaded, selected: DEFAULT_CONNECTION_ID }
          setSaved(updated)
          saveConnections(browserStorage(), updated)
          toast.warning('The previously selected server connection is no longer available.')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : 'Could not load server connections.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const persist = (next: SavedConnections) => {
    setSaved(next)
    if (!saveConnections(browserStorage(), next)) {
      toast.warning('Browser storage is unavailable; changes will last only in this tab.')
    }
  }
  const apply = (id: string, username: string, secret: string) => {
    if (id.startsWith('server:')) {
      const server = managed.find((item) => item.id === id.slice(7))
      if (!server) throw new Error('Unknown server-managed connection.')
    } else {
      const browser = saved.browsers.find((item) => item.id === id)
      if (!browser) throw new Error('Unknown browser connection.')
      makeBrowserAuthorization(browser.auth, username, secret)
    }
    setCredentials({ username, secret })
    setConnectionEpoch((value) => value + 1)
    persist({ ...saved, selected: id })
    toast.success('Connection selected.')
  }
  const upsert = (profile: BrowserConnection, username: string, secret: string) => {
    makeBrowserAuthorization(profile.auth, username, secret)
    const browsers = saved.browsers.some((item) => item.id === profile.id)
      ? saved.browsers.map((item) => (item.id === profile.id ? profile : item))
      : [...saved.browsers, profile]
    if (browsers.length > 20) throw new Error('You can save up to 20 browser connections.')
    setCredentials({ username, secret })
    setConnectionEpoch((value) => value + 1)
    persist({ browsers, selected: profile.id })
    toast.success('Browser connection saved.')
  }
  const remove = (id: string) => {
    if (id === DEFAULT_CONNECTION_ID) return
    const browsers = saved.browsers.filter((item) => item.id !== id)
    if (browsers.length === saved.browsers.length) return
    setCredentials({ username: '', secret: '' })
    setConnectionEpoch((value) => value + 1)
    persist({ browsers, selected: saved.selected === id ? DEFAULT_CONNECTION_ID : saved.selected })
    toast.success('Connection removed.')
  }

  const server = saved.selected.startsWith('server:')
    ? managed.find((item) => `server:${item.id}` === saved.selected)
    : undefined
  const browser = saved.browsers.find((item) => item.id === saved.selected)
  const activeBrowser = browser ?? saved.browsers[0]
  const selectionKey = server ? saved.selected : (activeBrowser?.id ?? DEFAULT_CONNECTION_ID)
  const connection = useMemo<ConnectionChoice>(() => {
    if (server) return { kind: 'server', id: server.id }
    return {
      kind: 'browser',
      url: activeBrowser?.url ?? DEFAULT_BACKEND_URL,
      authorization:
        activeBrowser?.auth && activeBrowser.auth !== 'none' && credentials.secret
          ? makeBrowserAuthorization(activeBrowser.auth, credentials.username, credentials.secret)
          : undefined,
    }
  }, [server, activeBrowser, credentials])

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f6f8fb] text-slate-900 dark:bg-[#0c1b2c] dark:text-slate-100">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <RefreshCw className="size-5 animate-spin text-sky-600 dark:text-sky-400" /> Opening
          Gotenui...
        </div>
      </div>
    )
  return (
    <Workspace
      connection={connection}
      connectionName={server?.name ?? activeBrowser?.name ?? 'Gotenberg demo'}
      selectedConnection={selectionKey}
      connectionEpoch={connectionEpoch}
      browserProfiles={saved.browsers}
      managedProfiles={managed}
      features={features}
      onApply={apply}
      onUpsert={upsert}
      onRemove={remove}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  )
}

export { Brand, GotenuiApp, Sidebar }
