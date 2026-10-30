import {
  Activity,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  ExternalLink,
  FileDown,
  FileText,
  FileUp,
  Globe2,
  Layers3,
  ListPlus,
  Menu,
  PanelLeftClose,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RemoteInputsEditor, WebhookEditor } from '#/components/async-inputs-editor'
import { AttachmentMetadataEditor } from '#/components/attachment-metadata-editor'
import { BrowserBatchQueuePanel } from '#/components/browser-batch-queue'
import {
  ChromiumNetworkEditor,
  type CookieRow,
  type HeaderRow,
} from '#/components/chromium-network-editor'
import { ChromiumPdfAssets } from '#/components/chromium-pdf-assets'
import { codeOutputClasses } from '#/components/code-output'
import { ThemeSelect } from '#/components/color-theme-provider'
import { ConnectionManager } from '#/components/connection-manager'
import { ConversionPresets } from '#/components/conversion-presets'
import { DiagnosticsDialog } from '#/components/diagnostics-dialog'
import { HtmlSourceImport } from '#/components/html-source-import'
import { MarkdownAssetsEditor, type MarkdownSource } from '#/components/markdown-assets-editor'
import { operationIcon } from '#/components/operation-icons'
import { OperationSearchDialog } from '#/components/operation-search-dialog'
import {
  defaultOverlay,
  OverlayGroupsEditor,
  PdfConversionPostProcessing,
} from '#/components/pdf-conversion-post-processing'
import { PdfResultPreview } from '#/components/pdf-result-preview'
import { PdfBookmarksEditor, PdfMetadataEditor } from '#/components/pdf-structure-editors'
import { Button } from '#/components/ui/button'
import { ButtonTooltip } from '#/components/ui/button-tooltip'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { UploadZone } from '#/components/upload-zone'
import { useModalFocus } from '#/components/use-modal-focus'
import { appVersionLabel } from '#/lib/app-version'
import {
  emptyWebhook,
  type RemoteInputRow,
  remoteInputsPayload,
  safeOutboundHost,
  type WebhookEditorState,
  webhookPayload,
} from '#/lib/async-inputs'
import { browserStorage } from '#/lib/backend-url'
import { BrowserBatchQueue } from '#/lib/browser-batch-queue'
import { DEFAULT_MARKDOWN_NAME } from '#/lib/chromium-documents'
import { chromiumNetworkFields } from '#/lib/chromium-network'
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
import {
  convertWithGotenberg,
  getGotenbergStatus,
  MAX_UPLOAD_BYTES,
  REQUEST_TIMEOUT_MS,
  type ServerStatus,
} from '#/lib/gotenberg-client'
import { OFFICE_ACCEPT } from '#/lib/office-formats'
import {
  CONSOLE_MESSAGE_TYPES,
  parseConsoleMessageTypes,
  updateConsoleMessageTypes,
} from '#/lib/official-form-fields'
import { unavailableOperationReason, versionAtLeast } from '#/lib/operation-availability'
import { isSearchShortcut } from '#/lib/operation-search'
import {
  activeOperationFields,
  type FieldDefinition,
  GROUPS,
  isFieldVisible,
  OPERATION_BY_ID,
  OPERATIONS,
  type Operation,
  operationDefaults,
} from '#/lib/operations'
import {
  type OverlayKind,
  overlayUploads,
  PDF_POST_PROCESS_IDS,
  type PdfPostProcess,
  type PostProcessFiles,
} from '#/lib/pdf-post-processing'
import { importReadableBookmarks, importReadableMetadata } from '#/lib/pdf-read-import'
import { formatBytes } from '#/lib/security'
import { cn } from '#/lib/utils'
import { InputError, parseAdvanced } from '#/lib/validation'
import { version as appVersion } from '../../package.json'

const EXAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My document</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 48px; color: #172033; }
      h1 { font-size: 34px; margin-bottom: 12px; }
      p { line-height: 1.65; color: #475569; }
    </style>
  </head>
  <body>
    <h1>Hello from Gotenui</h1>
    <p>Every great document begins with an idea.</p>
  </body>
</html>`
const EXAMPLE_MARKDOWN = `# Hello from Gotenui

Turn plain text into beautiful, portable documents.

- **Write** your content in Markdown
- **Render** with Chromium
- **Download** the result

> Your documents, your infrastructure.`

type Job = {
  id: number
  operation: string
  name: string
  size: number
  elapsed: number
  trace?: string
}
type AcceptedWebhook = {
  status: 202 | 204
  trace?: string
  receiverHost: string
}
type Download = {
  url: string
  name: string
  size: number
  type: string
  preview?: string
  trace?: string
}

export function Brand({ compact = false }: { compact?: boolean }) {
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

export function Sidebar({
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
          <Brand />
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

export function FieldControl({
  field,
  value,
  onChange,
  disabled = false,
  backendVersion,
}: {
  field: FieldDefinition
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  disabled?: boolean
  backendVersion?: string
}) {
  const id = useId()
  const unsupported =
    field.minGotenbergMinor !== undefined &&
    versionAtLeast(backendVersion, field.minGotenbergMinor) === false
  const inactive = disabled || unsupported
  if (field.kind === 'console-message-types') {
    let selected: string[] = []
    try {
      if (typeof value === 'string' && value) selected = parseConsoleMessageTypes(value)
    } catch {
      // An invalid saved draft can still be corrected without crashing the editor.
    }
    const encoded = selected.length ? JSON.stringify(selected) : ''
    return (
      <fieldset className="col-span-full space-y-2">
        <legend className="text-sm font-medium">{field.label}</legend>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-800/40">
          {CONSOLE_MESSAGE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="checkbox"
                checked={selected.includes(type)}
                onChange={(event) =>
                  onChange(updateConsoleMessageTypes(encoded, type, event.target.checked))
                }
                disabled={disabled || (unsupported && !selected.includes(type))}
                className="size-4 accent-sky-600"
              />
              {type}
            </label>
          ))}
        </div>
        {field.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
        )}
      </fieldset>
    )
  }
  if (field.kind === 'toggle')
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 px-3.5 py-3">
        <div>
          <Label htmlFor={id} className="cursor-pointer">
            {field.label}
          </Label>
          {field.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
          )}
        </div>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled || (unsupported && value !== true)}
        />
      </div>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-red-500 dark:text-red-400">*</span>}
      </Label>
      {field.kind === 'select' ? (
        <div className="relative">
          <select
            id={id}
            className="h-11 w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 pr-9 text-sm text-slate-900 dark:text-slate-100 outline-none focus-visible:border-sky-500 focus-visible:ring-4 focus-visible:ring-sky-100 dark:focus-visible:ring-sky-900"
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
            required={field.required}
            disabled={inactive}
          >
            {!field.required && <option value="">Default / not set</option>}
            {field.options?.map((option) => (
              <option
                key={option}
                value={option}
                disabled={option === 'PDF/A-4' && versionAtLeast(backendVersion, 39) === false}
              >
                {field.optionLabels?.[option] ?? option}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-3.5 right-3 size-4 text-slate-400" />
        </div>
      ) : field.kind === 'json' ? (
        <Textarea
          id={id}
          rows={4}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={field.placeholder ?? '{ }'}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          disabled={inactive}
        />
      ) : (
        <Input
          id={id}
          type={
            field.kind === 'color'
              ? 'color'
              : field.kind === 'password'
                ? 'password'
                : field.kind === 'number'
                  ? 'number'
                  : field.kind === 'url'
                    ? 'url'
                    : 'text'
          }
          min={field.min}
          max={field.max}
          step={field.kind === 'number' ? (field.integer ? 1 : 'any') : undefined}
          autoComplete={field.kind === 'password' ? 'new-password' : undefined}
          placeholder={field.placeholder}
          value={String(value ?? (field.kind === 'color' ? '#7ffe7f' : ''))}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          disabled={inactive}
        />
      )}
      {field.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
      )}
    </div>
  )
}

function JobPanel({
  operation,
  files,
  auxFiles,
  postFiles,
  source,
  pending,
  lastDownload,
  acceptedWebhook,
  onClearResult,
  recent,
}: {
  operation: Operation
  files: File[]
  auxFiles: File[]
  postFiles: PostProcessFiles
  source: string
  pending: boolean
  lastDownload: Download | null
  acceptedWebhook: AcceptedWebhook | null
  onClearResult: () => void
  recent: Job[]
}) {
  const Icon = operationIcon(operation.id)
  return (
    <div className="space-y-5 lg:sticky lg:top-7 lg:self-start">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Job overview</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
              <Icon className="size-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {operation.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{operation.group}</p>
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Method</span>
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                POST
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Gotenberg endpoint</span>
              <code className="block break-all rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-[11px] leading-5 text-slate-700 dark:text-slate-200">
                {operation.path}
              </code>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Files selected</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {files.length +
                  auxFiles.length +
                  (postFiles.embeds?.length ?? 0) +
                  overlayUploads(postFiles, 'watermark').length +
                  overlayUploads(postFiles, 'stamp').length +
                  Number(Boolean(postFiles.facturxXml))}
              </span>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Upload size</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {formatBytes(
                  [
                    ...files,
                    ...auxFiles,
                    ...(postFiles.embeds ?? []),
                    ...overlayUploads(postFiles, 'watermark'),
                    ...overlayUploads(postFiles, 'stamp'),
                    ...(postFiles.facturxXml ? [postFiles.facturxXml] : []),
                  ].reduce((sum, file) => sum + file.size, 0) +
                    new TextEncoder().encode(source).byteLength,
                )}
              </span>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Target output</span>
              <span className="font-semibold uppercase text-slate-700 dark:text-slate-200">
                {operation.output === 'image'
                  ? 'PNG / JPEG / WebP'
                  : operation.output === 'pdf' || operation.id === 'split'
                    ? 'PDF / ZIP'
                    : operation.output}
              </span>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-sky-50 dark:bg-sky-950/50 px-3 py-3 text-[11px] leading-5 text-sky-800 dark:text-sky-300">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            Your uploads are sent through Gotenui's server-side proxy, with a per-job file limit of
            {` ${formatBytes(MAX_UPLOAD_BYTES)}`}. The proxy only contacts approved Gotenberg URLs.
          </p>
        </CardContent>
      </Card>
      {(pending || lastDownload || acceptedWebhook) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Latest result
              </h2>
              {!pending && (
                <Button type="button" variant="ghost" size="sm" onClick={onClearResult}>
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {pending ? (
              <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <RefreshCw className="size-5 animate-spin text-sky-600 dark:text-sky-400" />
                Processing document...
              </div>
            ) : acceptedWebhook ? (
              <div role="status" className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-sky-800 dark:text-sky-300">
                  HTTP {acceptedWebhook.status}: accepted for asynchronous processing
                </p>
                <p>
                  Gotenberg has accepted this request, but conversion and callback delivery have
                  <strong> not</strong> been confirmed. Gotenui does not track callback history.
                </p>
                <p>
                  Check your external receiver ({acceptedWebhook.receiverHost}) for completion or
                  failure.
                </p>
                {acceptedWebhook.trace && (
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">
                      Gotenberg-Trace
                    </p>
                    <code className="block break-all rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-[11px]">
                      {acceptedWebhook.trace}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!navigator.clipboard?.writeText) {
                          toast.message('Select the trace ID above to copy it.')
                          return
                        }
                        void navigator.clipboard
                          .writeText(acceptedWebhook.trace ?? '')
                          .catch(() => toast.message('Select the trace ID above to copy it.'))
                      }}
                    >
                      Copy trace ID
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              lastDownload && (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                      <Check className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                        {lastDownload.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {formatBytes(lastDownload.size)} · Ready
                      </p>
                    </div>
                  </div>
                  {lastDownload.type === 'application/pdf' && (
                    <PdfResultPreview
                      key={lastDownload.url}
                      url={lastDownload.url}
                      name={lastDownload.name}
                    />
                  )}
                  {lastDownload.type.startsWith('image/') && (
                    <img
                      className="mb-4 max-h-52 w-full rounded-lg border border-slate-100 dark:border-slate-800 object-contain"
                      src={lastDownload.url}
                      alt="Latest screenshot"
                    />
                  )}
                  {lastDownload.preview && (
                    <pre
                      className={cn(codeOutputClasses, 'mb-4 max-h-56 rounded-lg p-3 text-[11px]')}
                    >
                      {lastDownload.preview}
                    </pre>
                  )}
                  <a
                    className="flex h-10 items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-700"
                    href={lastDownload.url}
                    download={lastDownload.name}
                  >
                    <ArrowDownToLine className="size-4" />
                    Download again
                  </a>
                  {lastDownload.trace && (
                    <p className="mt-3 break-all text-[10px] text-slate-400">
                      Trace: {lastDownload.trace}
                    </p>
                  )}
                </>
              )
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-slate-500 dark:text-slate-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Session activity
            </h2>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-3 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <FileDown className="size-4 text-slate-400" />
              </div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Nothing processed yet
              </p>
              <p className="mt-1 text-xs text-slate-400">Your recent jobs will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {recent.map((job) => (
                <li key={job.id} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {job.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {job.operation} · {(job.elapsed / 1000).toFixed(1)}s · {formatBytes(job.size)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Workbench({
  operation,
  unavailableReason,
  supportsOptimization,
  backendVersion,
  recent,
  onCompleted,
  connection,
  batchQueue,
}: {
  operation: Operation
  unavailableReason: string | null
  supportsOptimization: boolean
  backendVersion?: string
  recent: Job[]
  onCompleted: (job: Job) => void
  connection: ConnectionChoice
  batchQueue: BrowserBatchQueue
}) {
  const [fields, setFields] = useState<Record<string, string | boolean>>(() =>
    operationDefaults(operation),
  )
  const [source, setSource] = useState(EXAMPLE_HTML)
  const [markdownName, setMarkdownName] = useState(DEFAULT_MARKDOWN_NAME)
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownSource[]>([])
  const nextMarkdownId = useRef(0)
  const [markdownTemplate, setMarkdownTemplate] = useState<string | null>(null)
  const [headerHtml, setHeaderHtml] = useState('')
  const [footerHtml, setFooterHtml] = useState('')
  const [postProcess, setPostProcess] = useState<PdfPostProcess>({})
  const [postFiles, setPostFiles] = useState<PostProcessFiles>({})
  const [files, setFiles] = useState<File[]>([])
  const [auxFiles, setAuxFiles] = useState<File[]>([])
  const [advanced, setAdvanced] = useState('')
  const [cookies, setCookies] = useState<CookieRow[]>([])
  const [resourceHeaders, setResourceHeaders] = useState<HeaderRow[]>([])
  const nextNetworkId = useRef(0)
  const [remoteRows, setRemoteRows] = useState<RemoteInputRow[]>([])
  const [remoteInput, setRemoteInput] = useState('')
  const [webhookSettings, setWebhookSettings] = useState<WebhookEditorState>(emptyWebhook)
  const [webhookInput, setWebhookInput] = useState('')
  const nextOutboundId = useRef(0)
  const [acceptedWebhook, setAcceptedWebhook] = useState<AcceptedWebhook | null>(null)
  const [outputName, setOutputName] = useState('')
  const [requestTrace, setRequestTrace] = useState('')
  const [traceparent, setTraceparent] = useState('')
  const [tracestate, setTracestate] = useState('')
  const [pending, setPending] = useState(false)
  const [readingStructure, setReadingStructure] = useState(false)
  const readAbort = useRef<AbortController | null>(null)
  const [lastDownload, setLastDownload] = useState<Download | null>(null)
  const fileUrl = useRef<string | null>(null)
  const requestAbort = useRef<AbortController | null>(null)
  const clearResult = useCallback(() => {
    setLastDownload(null)
    setAcceptedWebhook(null)
    if (fileUrl.current) {
      URL.revokeObjectURL(fileUrl.current)
      fileUrl.current = null
    }
  }, [])
  useEffect(
    () => () => {
      requestAbort.current?.abort()
      readAbort.current?.abort()
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
    },
    [],
  )
  useEffect(() => {
    setFields(operationDefaults(operation))
    setSource(operation.input === 'markdown' ? EXAMPLE_MARKDOWN : EXAMPLE_HTML)
    setMarkdownName(DEFAULT_MARKDOWN_NAME)
    setMarkdownFiles([])
    setMarkdownTemplate(null)
    setHeaderHtml('')
    setFooterHtml('')
    setPostProcess({})
    setPostFiles({})
    setFiles([])
    setAuxFiles([])
    setAdvanced('')
    setCookies([])
    setResourceHeaders([])
    setRemoteRows([])
    setRemoteInput('')
    setWebhookSettings(emptyWebhook)
    setWebhookInput('')
    setAcceptedWebhook(null)
    readAbort.current?.abort()
    setReadingStructure(false)
    setOutputName('')
    setRequestTrace('')
    setTraceparent('')
    setTracestate('')
    clearResult()
  }, [operation, clearResult])
  const standaloneKind: OverlayKind | undefined =
    operation.id === 'watermark' || operation.id === 'stamp' ? operation.id : undefined
  const overlayProperty = standaloneKind === 'watermark' ? 'watermarks' : 'stamps'
  const activeStandaloneSettings: PdfPostProcess | undefined = standaloneKind
    ? {
        [overlayProperty]: postProcess[overlayProperty] ?? [defaultOverlay(standaloneKind)],
      }
    : undefined
  const hasMetadataEditor = operation.fields.some((field) => field.name === 'metadata')
  const hasBookmarksEditor = operation.fields.some((field) => field.name === 'bookmarks')
  const hasPdfStructureEditor = hasMetadataEditor || hasBookmarksEditor || operation.id === 'embed'
  const basicFields = standaloneKind
    ? []
    : operation.fields.filter(
        (field) =>
          !field.advanced &&
          !field.section &&
          isFieldVisible(field, fields) &&
          !(field.customEditor && field.kind === 'json') &&
          !(operation.id === 'embed' && field.name === 'embedsMetadata'),
      )
  const advancedFields = standaloneKind
    ? []
    : operation.fields.filter(
        (field) =>
          field.advanced &&
          !field.customEditor &&
          !field.section &&
          isFieldVisible(field, fields) &&
          !(operation.id === 'embed' && field.name === 'embedsMetadata'),
      )
  const featureSections = [
    {
      key: 'watermark',
      title: 'Native LibreOffice watermark',
      description: 'Add single-line or tiled text behind the source document before PDF export.',
    },
    {
      key: 'processing',
      title: 'Combine & split output',
      description: 'Build a single PDF or split pages after conversion.',
    },
    {
      key: 'compression',
      title: 'Image compression & optimization',
      description: 'Tune the PDF image quality and output size.',
    },
    {
      key: 'rendering',
      title: 'Browser appearance & accessibility',
      description: 'Emulate colour scheme, high contrast, reduced motion and display gamut.',
    },
    {
      key: 'reliability',
      title: 'Rendering & error checks',
      description: 'Detect missing resources, failed HTTP responses and JavaScript errors.',
    },
  ] as const
  const hasUpload = operation.input === 'pdf' || operation.input === 'office'
  const isSourceEditor = operation.input === 'html' || operation.input === 'markdown'
  const sourceExtension = operation.input === 'html' ? 'HTML' : 'Markdown'
  const operationHasFileAssets = isSourceEditor
  const hasPdfHeaderFooter = ['url-pdf', 'html-pdf', 'markdown-pdf'].includes(operation.id)
  const hasPostProcessing = PDF_POST_PROCESS_IDS.has(operation.id)
  const hasChromiumNetwork = operation.path.startsWith('/forms/chromium/')
  const docsUrl = `https://gotenberg.dev/docs/${operation.docs}`

  const updateField = (name: string, value: string | boolean) =>
    setFields((current) => ({ ...current, [name]: value }))
  const updateAux = (selected: File[]) => {
    setAuxFiles(selected)
    if ((operation.id === 'watermark' || operation.id === 'stamp') && selected[0]) {
      setFields((current) => ({
        ...current,
        [`${operation.id}Expression`]: selected[0]?.name ?? '',
      }))
    }
  }
  const readExistingPdfStructure = async () => {
    const metadata = operation.id === 'metadata-write'
    if (!metadata && operation.id !== 'bookmarks-write') return
    if (
      !files.length ||
      (metadata && files.length !== 1) ||
      pending ||
      readingStructure ||
      readAbort.current
    )
      return
    if (unavailableReason) {
      toast.error(unavailableReason)
      return
    }
    const controller = new AbortController()
    readAbort.current = controller
    setReadingStructure(true)
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const result = await convertWithGotenberg(
        connection,
        { operation: metadata ? 'metadata-read' : 'bookmarks-read', fields: {}, advanced: {} },
        files,
        [],
        signal,
      )
      if (signal.aborted) return
      if (result.mode !== 'download')
        throw new Error('Reading requires an immediate JSON response.')
      if (result.blob.size > 2_000_000)
        throw new Error('The PDF structure response is too large to edit.')
      const content: unknown = JSON.parse(await result.blob.text())
      const editable = metadata
        ? importReadableMetadata(content, files[0]?.name ?? '')
        : importReadableBookmarks(
            content,
            files.map((file) => file.name),
          )
      updateField(metadata ? 'metadata' : 'bookmarks', editable)
      toast.success(`Existing ${metadata ? 'metadata' : 'bookmarks'} loaded for editing.`)
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : 'Could not read the uploaded PDF.')
      }
    } finally {
      if (readAbort.current === controller) {
        readAbort.current = null
        setReadingStructure(false)
      }
    }
  }

  const buildCandidate = () => {
    const downloadFrom = remoteInputsPayload(remoteRows, remoteInput)
    const webhook = webhookPayload(webhookSettings, webhookInput)
    const selectedFields = activeOperationFields(operation, fields)
    if (selectedFields.pdfa === 'PDF/A-4' && versionAtLeast(backendVersion, 39) === false) {
      throw new Error('PDF/A-4 requires Gotenberg 8.39 or newer.')
    }
    if (selectedFields.failOnConsoleMessageTypes && versionAtLeast(backendVersion, 39) === false) {
      throw new Error('Console message checks require Gotenberg 8.39 or newer.')
    }
    if (
      operation.id === 'office-pdf' &&
      selectedFields.generateTaggedPdf === true &&
      versionAtLeast(backendVersion, 38) === false
    ) {
      throw new Error('LibreOffice PDF tagging requires Gotenberg 8.38 or newer.')
    }
    if (!supportsOptimization) {
      delete selectedFields.optimizeImages
      delete selectedFields.imageQuality
    }
    const candidate = {
      operation: operation.id,
      fields: standaloneKind
        ? {}
        : hasChromiumNetwork
          ? { ...selectedFields, ...chromiumNetworkFields(cookies, resourceHeaders) }
          : selectedFields,
      source: isSourceEditor ? source : undefined,
      markdownName: operation.input === 'markdown' ? markdownName : undefined,
      markdownFiles:
        operation.input === 'markdown' && markdownFiles.length
          ? markdownFiles.map(({ name, content }) => ({ name, content }))
          : undefined,
      markdownTemplate:
        operation.input === 'markdown' ? (markdownTemplate ?? undefined) : undefined,
      headerHtml: hasPdfHeaderFooter ? headerHtml || undefined : undefined,
      footerHtml: hasPdfHeaderFooter ? footerHtml || undefined : undefined,
      postProcess: standaloneKind
        ? activeStandaloneSettings
        : hasPostProcessing && Object.values(postProcess).some((value) => value !== undefined)
          ? postProcess
          : undefined,
      advanced: parseAdvanced(advanced),
      downloadFrom,
      webhook,
      outputName: outputName.trim() || undefined,
      requestTrace: requestTrace.trim() || undefined,
      traceparent: traceparent.trim() || undefined,
      tracestate: tracestate.trim() || undefined,
    }
    return candidate
  }

  const queueCurrent = () => {
    if (unavailableReason) {
      toast.error(unavailableReason)
      return
    }
    try {
      const id = batchQueue.enqueue({
        connection,
        candidate: buildCandidate(),
        files,
        auxiliary: auxFiles,
        postFiles,
      })
      toast.success(`Added job #${id} to the batch queue below.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the job.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (unavailableReason) {
      toast.error(unavailableReason)
      return
    }
    setPending(true)
    setAcceptedWebhook(null)
    try {
      const webhook = webhookPayload(webhookSettings, webhookInput)
      const candidate = buildCandidate()
      const start = performance.now()
      const controller = new AbortController()
      requestAbort.current = controller
      const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = AbortSignal.any([controller.signal, deadline])
      const result = await convertWithGotenberg(
        connection,
        candidate,
        files,
        auxFiles,
        signal,
        postFiles,
      )
      if (signal.aborted) {
        if (deadline.aborted) toast.error('Gotenberg did not respond within three minutes.')
        return
      }
      if (result.mode === 'webhook') {
        setAcceptedWebhook({
          status: result.status,
          trace: result.trace,
          receiverHost: safeOutboundHost(
            webhook && typeof webhook === 'object' && 'url' in webhook ? String(webhook.url) : '',
          ),
        })
        setLastDownload(null)
        if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
        fileUrl.current = null
        toast.message('Gotenberg accepted the request; callback delivery is not yet confirmed.')
        return
      }
      const { blob, type, name, trace } = result
      const url = URL.createObjectURL(blob)
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
      fileUrl.current = url
      const preview = type === 'application/json' ? (await blob.text()).slice(0, 16_000) : undefined
      setLastDownload({ name, size: blob.size, type, url, preview, trace })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      onCompleted({
        id: Date.now(),
        operation: operation.title,
        name,
        size: blob.size,
        elapsed: performance.now() - start,
        trace,
      })
      toast.success(`${name} is ready to download`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast.message('Conversion cancelled.')
        return
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        toast.error('Gotenberg did not respond within three minutes.')
        return
      }
      const message =
        error instanceof InputError || error instanceof Error
          ? error.message
          : 'Something went wrong.'
      toast.error(message)
    } finally {
      requestAbort.current = null
      setPending(false)
    }
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <form className="min-w-0 space-y-5" onSubmit={submit}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.1em] text-sky-700 dark:text-sky-300 uppercase">
                  <span className="size-1.5 rounded-full bg-sky-500" />
                  Step 01 / Your input
                </div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Source document
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Provide the content you want Gotenberg to process.
                </p>
              </div>
              <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {hasUpload ? (
                  <FileUp className="size-5" />
                ) : isSourceEditor ? (
                  <Code2 className="size-5" />
                ) : (
                  <Globe2 className="size-5" />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {unavailableReason && (
              <p
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                {unavailableReason} Choose another tool or connection.
              </p>
            )}
            {hasUpload && (
              <UploadZone
                label={
                  operation.input === 'pdf' ? 'Upload PDF documents' : 'Upload Office documents'
                }
                description={
                  operation.id === 'merge'
                    ? 'Select at least two PDFs. Gotenui prefixes uploaded filenames to preserve the order shown below.'
                    : operation.input === 'pdf'
                      ? 'Select PDF files to process. Multiple files may produce a ZIP archive.'
                      : 'Documents, slides, spreadsheets, drawings and images supported by Gotenberg.'
                }
                files={files}
                onChange={(nextFiles) => {
                  readAbort.current?.abort()
                  setFiles(nextFiles)
                }}
                accept={operation.input === 'pdf' ? '.pdf,application/pdf' : OFFICE_ACCEPT}
                multiple={true}
                reorder={
                  operation.id === 'merge' ||
                  (operation.id === 'office-pdf' && fields.merge === true)
                }
                allowDuplicateNames={
                  operation.id === 'merge' ||
                  (operation.id === 'office-pdf' && fields.merge === true)
                }
              />
            )}
            {operation.input === 'url' && (
              <FieldControl
                field={operation.fields[0] as FieldDefinition}
                value={fields.url}
                onChange={(value) => updateField('url', value)}
                backendVersion={backendVersion}
              />
            )}
            {isSourceEditor && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="source-editor">{sourceExtension} source</Label>
                  <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {operation.input === 'html' ? 'index.html' : markdownName}
                  </span>
                </div>
                <Textarea
                  id="source-editor"
                  spellCheck={false}
                  rows={14}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="min-h-72 resize-y p-5 font-mono text-xs leading-6 focus-visible:border-sky-500"
                />
                {operation.input === 'html' && <HtmlSourceImport onImport={setSource} />}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {operation.input === 'html'
                    ? 'HTML renders with Chromium, including inline CSS and scripts.'
                    : 'Edit this Markdown document, then add more named sources or customize its HTML template below.'}
                </p>
              </div>
            )}
            {operation.input === 'markdown' && (
              <MarkdownAssetsEditor
                primaryName={markdownName}
                onPrimaryNameChange={setMarkdownName}
                sources={markdownFiles}
                onSourcesChange={setMarkdownFiles}
                nextId={() => nextMarkdownId.current++}
                customTemplate={markdownTemplate}
                onCustomTemplateChange={setMarkdownTemplate}
              />
            )}
            {operationHasFileAssets && (
              <UploadZone
                label="Optional assets"
                description="Attach local images, fonts or stylesheets. Reference them by filename in the source."
                files={auxFiles}
                onChange={setAuxFiles}
                multiple={true}
              />
            )}
            {operation.auxiliary && !standaloneKind && (
              <UploadZone
                label={operation.auxiliary.label}
                description={operation.auxiliary.description}
                files={auxFiles}
                onChange={updateAux}
                multiple={operation.auxiliary.multiple}
                accept={operation.auxiliary.accept}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.1em] text-sky-700 dark:text-sky-300 uppercase">
              <span className="size-1.5 rounded-full bg-sky-500" />
              Step 02 / Configure
            </div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              Output settings
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Fine-tune how your output should look and behave.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {basicFields.filter((field) => !(operation.input === 'url' && field.name === 'url'))
              .length > 0 ? (
              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                {basicFields
                  .filter((field) => !(operation.input === 'url' && field.name === 'url'))
                  .map((field) => (
                    <FieldControl
                      key={field.name}
                      field={field}
                      value={fields[field.name]}
                      onChange={(value) => updateField(field.name, value)}
                      backendVersion={backendVersion}
                    />
                  ))}
              </div>
            ) : !standaloneKind && !hasPdfStructureEditor ? (
              <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                This operation works with its default settings.
              </p>
            ) : null}
            {(operation.id === 'metadata-write' || operation.id === 'bookmarks-write') && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    pending ||
                    readingStructure ||
                    Boolean(unavailableReason) ||
                    !files.length ||
                    (operation.id === 'metadata-write' && files.length !== 1)
                  }
                  onClick={readExistingPdfStructure}
                >
                  <RefreshCw className={cn('size-4', readingStructure && 'animate-spin')} />
                  {readingStructure ? 'Reading uploaded PDF…' : 'Read existing PDF values'}
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reads the uploaded PDF{operation.id === 'bookmarks-write' ? '(s)' : ''} into the
                  editor without downloading or copying JSON. Metadata import excludes read-only
                  tags.
                  {operation.id === 'metadata-write' && ' Select exactly one PDF.'}
                </p>
              </div>
            )}
            {hasMetadataEditor && (
              <PdfMetadataEditor
                value={String(fields.metadata ?? '{}')}
                onChange={(value) => updateField('metadata', value)}
              />
            )}
            {operation.id === 'embed' && (
              <AttachmentMetadataEditor
                files={auxFiles}
                value={String(fields.embedsMetadata ?? '')}
                onChange={(value) => updateField('embedsMetadata', value)}
              />
            )}
            {hasBookmarksEditor && (
              <PdfBookmarksEditor
                value={String(fields.bookmarks ?? '[]')}
                onChange={(value) => updateField('bookmarks', value)}
                allowFilenameMap
                filenames={files.map((file) => file.name)}
              />
            )}
            {standaloneKind && activeStandaloneSettings && (
              <OverlayGroupsEditor
                kind={standaloneKind}
                rows={activeStandaloneSettings[overlayProperty] ?? []}
                onRowsChange={(rows) => setPostProcess({ [overlayProperty]: rows })}
                files={overlayUploads(postFiles, standaloneKind)}
                onFilesChange={(uploads) =>
                  setPostFiles({ ...postFiles, [standaloneKind]: uploads })
                }
                minimum={1}
              />
            )}
            {hasPdfHeaderFooter && (
              <ChromiumPdfAssets
                headerHtml={headerHtml}
                footerHtml={footerHtml}
                onHeaderChange={setHeaderHtml}
                onFooterChange={setFooterHtml}
              />
            )}
            {hasPostProcessing && (
              <PdfConversionPostProcessing
                mode={
                  operation.id === 'merge'
                    ? 'merge'
                    : operation.id === 'split'
                      ? 'split'
                      : 'convert'
                }
                value={postProcess}
                onChange={setPostProcess}
                files={postFiles}
                onFilesChange={setPostFiles}
              />
            )}
            {featureSections.map(({ key, title, description }) => {
              const items = operation.fields.filter((field) => field.section === key)
              if (!items.length) return null
              return (
                <details
                  key={key}
                  className="group rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 marker:hidden">
                    <span>
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {title}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {description}
                      </span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t border-slate-200 px-4 py-4 dark:border-slate-700">
                    {key === 'compression' && !supportsOptimization && (
                      <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
                        PDF image optimization needs Gotenberg 8.36+. Native LibreOffice compression
                        is still available.
                      </p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {items
                        .filter((field) => isFieldVisible(field, fields))
                        .map((field) => (
                          <FieldControl
                            key={field.name}
                            field={field}
                            value={fields[field.name]}
                            onChange={(value) => updateField(field.name, value)}
                            backendVersion={backendVersion}
                            disabled={
                              !supportsOptimization &&
                              ['optimizeImages', 'imageQuality'].includes(field.name)
                            }
                          />
                        ))}
                    </div>
                  </div>
                </details>
              )
            })}
            <ConversionPresets operation={operation} fields={fields} onApply={setFields} />
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-5">
              <Label htmlFor="output-filename">
                Output filename <span className="font-normal text-slate-400">(optional)</span>
              </Label>
              <Input
                id="output-filename"
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder={`e.g. ${operation.id}-result (without extension)`}
                maxLength={100}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {operation.output === 'json'
                  ? 'Names the browser download. Gotenberg metadata responses do not support the output filename header.'
                  : 'Sets Gotenberg-Output-Filename and the browser download name. Gotenberg adds the extension automatically; leave blank for its default.'}
              </p>
            </div>
            <details
              className="group rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40"
              open={undefined}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-200 marker:hidden">
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-slate-500 dark:text-slate-400" />
                  Advanced options
                </span>
                <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-5 border-t border-slate-200 dark:border-slate-700 px-4 py-5">
                {advancedFields.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {advancedFields.map((field) => (
                      <FieldControl
                        key={field.name}
                        field={field}
                        value={fields[field.name]}
                        onChange={(value) => updateField(field.name, value)}
                        backendVersion={backendVersion}
                      />
                    ))}
                  </div>
                )}
                {hasChromiumNetwork && (
                  <ChromiumNetworkEditor
                    cookies={cookies}
                    onCookiesChange={setCookies}
                    headers={resourceHeaders}
                    onHeadersChange={setResourceHeaders}
                    newId={() => nextNetworkId.current++}
                  />
                )}
                <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                  <div>
                    <Label htmlFor="request-trace">Gotenberg request ID (optional)</Label>
                    <Input
                      id="request-trace"
                      value={requestTrace}
                      onChange={(event) => setRequestTrace(event.target.value)}
                      maxLength={128}
                      placeholder="e.g. invoice-batch-42"
                      className="mt-2 font-mono text-xs"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Gotenberg-Trace identifies a request in upstream logs and webhook callbacks.
                      It is not a distributed trace ID.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="traceparent">W3C traceparent (optional)</Label>
                    <Input
                      id="traceparent"
                      value={traceparent}
                      onChange={(event) => setTraceparent(event.target.value)}
                      maxLength={55}
                      placeholder="00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
                      className="mt-2 font-mono text-xs"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Continue an OpenTelemetry trace on Gotenberg 8.34+. Do not paste a secret or
                      unrelated identifier here.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="tracestate">W3C tracestate (optional)</Label>
                    <Input
                      id="tracestate"
                      value={tracestate}
                      onChange={(event) => setTracestate(event.target.value)}
                      maxLength={512}
                      placeholder="vendor=value"
                      className="mt-2 font-mono text-xs"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Optional vendor context; requires a valid traceparent.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="additional-fields">Additional Gotenberg form fields (JSON)</Label>
                  <Textarea
                    id="additional-fields"
                    rows={4}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={'{ "waitForExpression": "window.ready === true" }'}
                    value={advanced}
                    onChange={(event) => setAdvanced(event.target.value)}
                  />
                  <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                    Use this for documented options not shown above. Enter flat JSON key/value
                    pairs; enter remote inputs and webhooks separately below.
                  </p>
                </div>
                <RemoteInputsEditor
                  rows={remoteRows}
                  onChange={setRemoteRows}
                  legacy={remoteInput}
                  onLegacyChange={setRemoteInput}
                  newId={() => nextOutboundId.current++}
                />
                <WebhookEditor
                  value={webhookSettings}
                  onChange={setWebhookSettings}
                  legacy={webhookInput}
                  onLegacyChange={setWebhookInput}
                  newId={() => nextOutboundId.current++}
                />
              </div>
            </details>
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="size-4 text-emerald-500" />
            <span>Processing through the same-origin Gotenui proxy</span>
          </div>
          {pending && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => requestAbort.current?.abort()}
            >
              Cancel
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending || Boolean(unavailableReason)}
              onClick={queueCurrent}
            >
              <ListPlus className="size-4" /> Add to batch
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={pending || Boolean(unavailableReason)}
              className="min-w-44"
            >
              {pending ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
              {pending ? 'Processing...' : 'Run operation'}
            </Button>
          </div>
        </div>
      </form>
      <JobPanel
        operation={operation}
        files={files}
        auxFiles={auxFiles}
        postFiles={postFiles}
        source={isSourceEditor ? source : ''}
        pending={pending}
        lastDownload={lastDownload}
        acceptedWebhook={acceptedWebhook}
        onClearResult={clearResult}
        recent={recent}
      />
      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:text-sky-900 dark:hover:text-sky-200 xl:col-span-2"
      >
        <ExternalLink className="size-4" />
        Review official Gotenberg documentation for {operation.title}
      </a>
    </div>
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
}: {
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
  const [selectedId, setSelectedId] = useState('url-pdf')
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
    document.title = `${operation.title} · Gotenui`
  }, [operation.title])
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
        onSelect={setSelectedId}
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
              {operation.group}
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
                    onClick={() => setSelectedId(item.id)}
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
          <BrowserBatchQueuePanel queue={batchQueue} />
        </main>
      </div>
      {searchOpen && (
        <OperationSearchDialog
          unavailableReason={(item) => unavailableOperationReason(status, item)}
          onClose={closeSearch}
          onSelect={(id) => {
            setSelectedId(id)
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

export function GotenuiApp() {
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
    />
  )
}
