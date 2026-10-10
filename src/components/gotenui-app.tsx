import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowDownToLine,
  Braces,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileDown,
  FileJson2,
  FilePlus2,
  FileStack,
  Files,
  FileText,
  FileUp,
  Globe2,
  Image,
  Layers3,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RemoteInputsEditor, WebhookEditor } from '#/components/async-inputs-editor'
import {
  ChromiumNetworkEditor,
  type CookieRow,
  type HeaderRow,
} from '#/components/chromium-network-editor'
import { ChromiumPdfAssets } from '#/components/chromium-pdf-assets'
import { ConnectionManager } from '#/components/connection-manager'
import { DebugDialog } from '#/components/debug-dialog'
import { MarkdownAssetsEditor, type MarkdownSource } from '#/components/markdown-assets-editor'
import { MetricsDialog } from '#/components/metrics-dialog'
import {
  defaultOverlay,
  OverlayGroupsEditor,
  PdfConversionPostProcessing,
} from '#/components/pdf-conversion-post-processing'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { UploadZone } from '#/components/upload-zone'
import {
  emptyWebhook,
  type RemoteInputRow,
  remoteInputsPayload,
  safeOutboundHost,
  type WebhookEditorState,
  webhookPayload,
} from '#/lib/async-inputs'
import { browserStorage } from '#/lib/backend-url'
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
  probeGotenbergHealth,
  REQUEST_TIMEOUT_MS,
  type ServerStatus,
} from '#/lib/gotenberg-client'
import {
  type FieldDefinition,
  GROUPS,
  OPERATION_BY_ID,
  OPERATIONS,
  type Operation,
  operationDefaults,
} from '#/lib/operations'
import {
  type OverlayKind,
  overlayUploads,
  PDF_CONVERSION_IDS,
  type PdfPostProcess,
  type PostProcessFiles,
} from '#/lib/pdf-post-processing'
import { formatBytes } from '#/lib/security'
import { cn } from '#/lib/utils'
import { InputError, parseAdvanced } from '#/lib/validation'

const ICONS: Record<string, LucideIcon> = {
  'url-pdf': Globe2,
  'html-pdf': Code2,
  'markdown-pdf': FileCode2,
  'office-pdf': FileUp,
  'url-shot': Camera,
  'html-shot': Image,
  'markdown-shot': Image,
  merge: Files,
  split: FileStack,
  pdfa: ShieldCheck,
  optimize: WandSparkles,
  rotate: RotateCw,
  flatten: Layers3,
  encrypt: LockKeyhole,
  watermark: FileText,
  stamp: FilePlus2,
  'metadata-read': FileJson2,
  'metadata-write': FileJson2,
  'bookmarks-read': Braces,
  'bookmarks-write': Braces,
  embed: FileArchive,
  'factur-x': FileText,
}

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

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-lg shadow-sky-950/15">
        <img src="/gotenui-icon.svg" alt="" className="size-full" />
      </div>
      {!compact && (
        <div>
          <p className="text-[19px] font-extrabold tracking-tight text-white">
            Gotenui<span className="text-sky-400">.</span>
          </p>
          <p className="mt-[-2px] text-[10px] font-medium tracking-[.13em] text-slate-400">
            GOTENBERG WORKSPACE
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
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-5 pt-[9vh]">
      <button
        type="button"
        aria-label="Close connection settings"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-heading"
        className="relative w-full max-w-[550px] rounded-2xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="connection-heading" className="text-lg font-extrabold tracking-tight">
              Connection settings
            </h2>
            <p className="mt-1 text-xs text-slate-500">
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
  mobileOpen,
  setMobileOpen,
}: {
  selectedId: string
  onSelect: (id: string) => void
  status: ServerStatus | null
  onSettings: () => void
  mobileOpen: boolean
  setMobileOpen: (state: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const matches = useMemo(
    () =>
      OPERATIONS.filter((operation) =>
        `${operation.title} ${operation.summary}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
      ),
    [search],
  )
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/70 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col bg-[#0c1b2c] text-white shadow-2xl transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-6">
          <Brand />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Close menu"
            className="text-slate-300 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <PanelLeftClose className="size-5" />
          </Button>
        </div>
        <div className="px-4 pt-5">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-slate-500" />
            <input
              aria-label="Search operations"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a tool..."
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pr-3 pl-9 text-xs text-white outline-none placeholder:text-slate-500 focus:border-sky-500 focus:ring-2 focus:ring-sky-900"
            />
          </div>
        </div>
        <nav
          className="nav-scroll mt-5 flex-1 overflow-y-auto px-3 pb-6"
          aria-label="Gotenberg operations"
        >
          {GROUPS.map((group) => {
            const items = matches.filter((operation) => operation.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="mb-5">
                <p className="mb-2 px-3 text-[10px] font-extrabold tracking-[.16em] text-slate-500 uppercase">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map((operation) => {
                    const Icon = ICONS[operation.id] ?? FileText
                    const active = selectedId === operation.id
                    return (
                      <button
                        key={operation.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => {
                          onSelect(operation.id)
                          setMobileOpen(false)
                        }}
                        className={cn(
                          'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-[10px] text-left text-[13px] font-medium transition-colors',
                          active
                            ? 'bg-sky-500/15 text-sky-300'
                            : 'text-slate-400 hover:bg-white/7 hover:text-white',
                        )}
                      >
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            active ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-300',
                          )}
                        />
                        <span className="flex-1 truncate">{operation.title}</span>
                        {active && <span className="size-1.5 rounded-full bg-sky-400" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {matches.length === 0 && (
            <p className="px-3 text-xs text-slate-400">No operations match that search.</p>
          )}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <span
              className={cn(
                'relative flex size-2 shrink-0 rounded-full',
                status?.online ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">Gotenberg service</p>
              <p className="truncate text-[11px] text-slate-400">
                {status
                  ? status.online
                    ? `Online · ${status.version}`
                    : 'Not responding'
                  : 'Checking connection...'}
              </p>
            </div>
            <Activity className="size-4 text-slate-500" />
          </div>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/7 hover:text-white"
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

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
}) {
  const id = useId()
  if (field.kind === 'toggle')
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3">
        <div>
          <Label htmlFor={id} className="cursor-pointer">
            {field.label}
          </Label>
          {field.description && <p className="mt-1 text-xs text-slate-500">{field.description}</p>}
        </div>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      {field.kind === 'select' ? (
        <div className="relative">
          <select
            id={id}
            className="h-11 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3.5 pr-9 text-sm text-slate-900 outline-none focus-visible:border-sky-500 focus-visible:ring-4 focus-visible:ring-sky-100"
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
            required={field.required}
          >
            {!field.required && <option value="">Default / not set</option>}
            {field.options?.map((option) => (
              <option key={option} value={option}>
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
        />
      ) : (
        <Input
          id={id}
          type={
            field.kind === 'password'
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
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
        />
      )}
      {field.description && <p className="text-xs text-slate-500">{field.description}</p>}
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
  recent: Job[]
}) {
  const Icon = ICONS[operation.id] ?? FileText
  return (
    <div className="space-y-5 lg:sticky lg:top-7 lg:self-start">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-sky-600" />
            <h2 className="text-sm font-bold text-slate-900">Job overview</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Icon className="size-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{operation.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{operation.group}</p>
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500">Method</span>
              <span className="font-mono font-semibold text-slate-700">POST</span>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-500">Gotenberg endpoint</span>
              <code className="block break-all rounded-lg bg-slate-100 px-3 py-2.5 text-[11px] leading-5 text-slate-700">
                {operation.path}
              </code>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500">Files selected</span>
              <span className="font-semibold text-slate-700">
                {files.length +
                  auxFiles.length +
                  (postFiles.embeds?.length ?? 0) +
                  overlayUploads(postFiles, 'watermark').length +
                  overlayUploads(postFiles, 'stamp').length +
                  Number(Boolean(postFiles.facturxXml))}
              </span>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <span className="text-slate-500">Upload size</span>
              <span className="font-semibold text-slate-700">
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
              <span className="text-slate-500">Target output</span>
              <span className="font-semibold uppercase text-slate-700">
                {operation.output === 'image'
                  ? 'PNG / JPEG / WebP'
                  : operation.output === 'pdf' || operation.id === 'split'
                    ? 'PDF / ZIP'
                    : operation.output}
              </span>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-3 text-[11px] leading-5 text-sky-800">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            Your uploads are sent through Gotenui's server-side proxy, with a per-job file limit of
            {` ${formatBytes(MAX_UPLOAD_BYTES)}`}. The proxy only contacts approved Gotenberg URLs.
          </p>
        </CardContent>
      </Card>
      {(pending || lastDownload || acceptedWebhook) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-slate-900">Latest result</h2>
          </CardHeader>
          <CardContent>
            {pending ? (
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <RefreshCw className="size-5 animate-spin text-sky-600" />
                Processing document...
              </div>
            ) : acceptedWebhook ? (
              <div role="status" className="space-y-3 text-xs text-slate-600">
                <p className="font-semibold text-sky-800">
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
                    <p className="font-semibold text-slate-700">Gotenberg-Trace</p>
                    <code className="block break-all rounded-lg bg-slate-100 px-3 py-2 text-[11px]">
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
                    <div className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {lastDownload.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatBytes(lastDownload.size)} · Ready
                      </p>
                    </div>
                  </div>
                  {lastDownload.type.startsWith('image/') && (
                    <img
                      className="mb-4 max-h-52 w-full rounded-lg border border-slate-100 object-contain"
                      src={lastDownload.url}
                      alt="Latest screenshot"
                    />
                  )}
                  {lastDownload.preview && (
                    <pre className="mb-4 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-sky-100">
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
            <Clock3 className="size-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Session activity</h2>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-3 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-slate-100">
                <FileDown className="size-4 text-slate-400" />
              </div>
              <p className="text-xs font-semibold text-slate-700">Nothing processed yet</p>
              <p className="mt-1 text-xs text-slate-400">Your recent jobs will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {recent.map((job) => (
                <li key={job.id} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">{job.name}</p>
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
  recent,
  onCompleted,
  connection,
}: {
  operation: Operation
  recent: Job[]
  onCompleted: (job: Job) => void
  connection: ConnectionChoice
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
  const [lastDownload, setLastDownload] = useState<Download | null>(null)
  const fileUrl = useRef<string | null>(null)
  const requestAbort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      requestAbort.current?.abort()
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
    setOutputName('')
    setRequestTrace('')
    setTraceparent('')
    setTracestate('')
    setLastDownload(null)
    if (fileUrl.current) {
      URL.revokeObjectURL(fileUrl.current)
      fileUrl.current = null
    }
  }, [operation])
  const standaloneKind: OverlayKind | undefined =
    operation.id === 'watermark' || operation.id === 'stamp' ? operation.id : undefined
  const overlayProperty = standaloneKind === 'watermark' ? 'watermarks' : 'stamps'
  const activeStandaloneSettings: PdfPostProcess | undefined = standaloneKind
    ? {
        [overlayProperty]: postProcess[overlayProperty] ?? [defaultOverlay(standaloneKind)],
      }
    : undefined
  const basicFields = standaloneKind ? [] : operation.fields.filter((field) => !field.advanced)
  const advancedFields = standaloneKind
    ? []
    : operation.fields.filter((field) => field.advanced && !field.customEditor)
  const hasUpload = operation.input === 'pdf' || operation.input === 'office'
  const isSourceEditor = operation.input === 'html' || operation.input === 'markdown'
  const sourceExtension = operation.input === 'html' ? 'HTML' : 'Markdown'
  const operationHasFileAssets = isSourceEditor
  const hasPdfHeaderFooter = ['url-pdf', 'html-pdf', 'markdown-pdf'].includes(operation.id)
  const hasPostProcessing = PDF_CONVERSION_IDS.has(operation.id)
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setAcceptedWebhook(null)
    try {
      const downloadFrom = remoteInputsPayload(remoteRows, remoteInput)
      const webhook = webhookPayload(webhookSettings, webhookInput)
      const candidate = {
        operation: operation.id,
        fields: standaloneKind
          ? {}
          : hasChromiumNetwork
            ? { ...fields, ...chromiumNetworkFields(cookies, resourceHeaders) }
            : fields,
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
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.1em] text-sky-700 uppercase">
                  <span className="size-1.5 rounded-full bg-sky-500" />
                  Step 01 / Your input
                </div>
                <h2 className="text-base font-extrabold text-slate-900">Source document</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Provide the content you want Gotenberg to process.
                </p>
              </div>
              <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
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
                      : 'Word, Excel, PowerPoint, OpenDocument, images and other supported formats.'
                }
                files={files}
                onChange={setFiles}
                accept={
                  operation.input === 'pdf'
                    ? '.pdf,application/pdf'
                    : '.doc,.docx,.docm,.odt,.rtf,.txt,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.pps,.pages,.numbers,.key,.svg,.png,.jpg,.jpeg,.gif,.tiff,.bmp,.html,.epub,.pdf,.xml'
                }
                multiple={true}
                reorder={operation.id === 'merge'}
                allowDuplicateNames={operation.id === 'merge'}
              />
            )}
            {operation.input === 'url' && (
              <FieldControl
                field={operation.fields[0] as FieldDefinition}
                value={fields.url}
                onChange={(value) => updateField('url', value)}
              />
            )}
            {isSourceEditor && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="source-editor">{sourceExtension} source</Label>
                  <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] font-semibold text-slate-500">
                    {operation.input === 'html' ? 'index.html' : markdownName}
                  </span>
                </div>
                <Textarea
                  id="source-editor"
                  spellCheck={false}
                  rows={14}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="min-h-72 resize-y bg-[#0d1e2e] p-5 font-mono text-xs leading-6 text-sky-100 focus-visible:border-sky-500"
                />
                <p className="text-xs text-slate-500">
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
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.1em] text-sky-700 uppercase">
              <span className="size-1.5 rounded-full bg-sky-500" />
              Step 02 / Configure
            </div>
            <h2 className="text-base font-extrabold text-slate-900">Output settings</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
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
                    />
                  ))}
              </div>
            ) : !standaloneKind ? (
              <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
                This operation works with its default settings.
              </p>
            ) : null}
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
                value={postProcess}
                onChange={setPostProcess}
                files={postFiles}
                onFilesChange={setPostFiles}
              />
            )}
            <div className="space-y-2 border-t border-slate-100 pt-5">
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
              <p className="text-xs text-slate-500">
                {operation.output === 'json'
                  ? 'Names the browser download. Gotenberg metadata responses do not support the output filename header.'
                  : 'Sets Gotenberg-Output-Filename and the browser download name. Gotenberg adds the extension automatically; leave blank for its default.'}
              </p>
            </div>
            <details
              className="group rounded-xl border border-slate-200 bg-slate-50/50"
              open={undefined}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-sm font-semibold text-slate-700 marker:hidden">
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-slate-500" />
                  Advanced options
                </span>
                <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-5 border-t border-slate-200 px-4 py-5">
                {advancedFields.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {advancedFields.map((field) => (
                      <FieldControl
                        key={field.name}
                        field={field}
                        value={fields[field.name]}
                        onChange={(value) => updateField(field.name, value)}
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
                <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
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
                    <p className="mt-1 text-xs text-slate-500">
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
                    <p className="mt-1 text-xs text-slate-500">
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
                    <p className="mt-1 text-xs text-slate-500">
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
                  <p className="text-[11px] leading-5 text-slate-500">
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
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500">
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
          <Button type="submit" size="lg" disabled={pending} className="min-w-44">
            {pending ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
            {pending ? 'Processing...' : 'Run operation'}
          </Button>
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
        recent={recent}
      />
      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 text-xs font-semibold text-sky-700 hover:text-sky-900 xl:col-span-2"
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const operation = OPERATION_BY_ID.get(selectedId) ?? (OPERATIONS[0] as Operation)
  const Icon = ICONS[operation.id] ?? FileText
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [probeLoading, setProbeLoading] = useState(false)
  const probeAbort = useRef<AbortController | null>(null)
  const statusAbort = useRef<AbortController | null>(null)
  const refreshStatus = useCallback(async () => {
    statusAbort.current?.abort()
    const controller = new AbortController()
    statusAbort.current = controller
    setStatusLoading(true)
    const timeout = window.setTimeout(() => controller.abort(), 7_000)
    try {
      const result = await getGotenbergStatus(connection, controller.signal)
      if (!controller.signal.aborted) setStatus(result)
    } catch {
      if (statusAbort.current === controller) {
        setStatus({
          online: false,
          version: 'Unavailable',
          modules: [],
          error: 'Connection test timed out.',
        })
      }
    } finally {
      window.clearTimeout(timeout)
      if (statusAbort.current === controller) {
        statusAbort.current = null
        setStatusLoading(false)
      }
    }
  }, [connection])
  const probeHealth = useCallback(async () => {
    probeAbort.current?.abort()
    const controller = new AbortController()
    probeAbort.current = controller
    setProbeLoading(true)
    try {
      const healthy = await probeGotenbergHealth(
        connection,
        AbortSignal.any([controller.signal, AbortSignal.timeout(7_000)]),
      )
      if (!controller.signal.aborted) {
        if (healthy) toast.success('Gotenberg health probe returned 200 (healthy).')
        else toast.warning('Gotenberg health probe returned 503 (unhealthy).')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : 'Health probe failed.')
      }
    } finally {
      if (probeAbort.current === controller) {
        probeAbort.current = null
        setProbeLoading(false)
      }
    }
  }, [connection])
  useEffect(() => {
    setStatus(null)
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 30_000)
    return () => {
      window.clearInterval(timer)
      statusAbort.current?.abort()
      statusAbort.current = null
      probeAbort.current?.abort()
      probeAbort.current = null
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
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <Sidebar
        selectedId={selectedId}
        onSelect={setSelectedId}
        status={status}
        onSettings={() => setSettingsOpen(true)}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="min-h-screen lg:pl-[270px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-5 backdrop-blur-xl md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-xs font-semibold text-slate-500">Workspace</span>
            <span className="text-slate-300">/</span>
            <span className="truncate text-xs font-bold text-slate-900">{operation.group}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:flex',
                status?.online
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  status?.online ? 'bg-emerald-500' : 'bg-amber-500',
                )}
              />
              {status?.online
                ? 'Service online'
                : statusLoading
                  ? 'Checking...'
                  : 'Service offline'}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh service status"
              onClick={() => void refreshStatus()}
              disabled={statusLoading}
            >
              <RefreshCw className={cn('size-4', statusLoading && 'animate-spin')} />
            </Button>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void probeHealth()}
              disabled={probeLoading}
              aria-label="Probe Gotenberg HEAD health"
              title="Probe HEAD /health (200 healthy, 503 unhealthy)"
            >
              <Activity className={cn('size-4', probeLoading && 'animate-pulse')} />
              <span className="hidden md:inline">Probe</span>
            </Button>
            {features.showDebug && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDebugOpen(true)}
                aria-label="Open debug diagnostics"
              >
                <Braces className="size-4" />
                <span className="hidden md:inline">Diagnostics</span>
              </Button>
            )}
            {!features.showDebug && features.showMetrics && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMetricsOpen(true)}
                aria-label="Open Prometheus metrics"
              >
                <Activity className="size-4" />
                <span className="hidden md:inline">Metrics</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              title={connectionName}
            >
              <Settings2 className="size-4" />
              <span className="hidden max-w-44 truncate md:inline">{connectionName}</span>
              <span className="md:hidden">Settings</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1390px] px-5 pt-8 pb-14 md:px-9 md:pt-10">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <p className="mb-3 flex items-center gap-2 text-[11px] font-extrabold tracking-[.16em] text-sky-700 uppercase">
                <Sparkles className="size-3.5" />
                Document operations
              </p>
              <div className="flex items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-600">
                  <Icon className="size-6" />
                </div>
                <h1 className="text-[29px] font-extrabold tracking-[-.04em] text-slate-950 sm:text-[36px]">
                  {operation.title}
                </h1>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                {operation.summary} Configure your output and let Gotenberg take care of the rest.
              </p>
            </div>
            <a
              href="https://gotenberg.dev/docs/getting-started/routes"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              <FileText className="size-4" />
              API reference
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <div className="mb-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Connection</span>
                <Activity className="size-4 text-slate-400" />
              </div>
              <p className="mt-2 flex items-center gap-2 text-base font-extrabold text-slate-900">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    status?.online ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                {status?.online ? 'Operational' : statusLoading ? 'Checking' : 'Unavailable'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Gotenberg version</span>
                <Layers3 className="size-4 text-slate-400" />
              </div>
              <p className="mt-2 truncate text-base font-extrabold text-slate-900">
                {status?.version ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Modules healthy</span>
                <CheckCircle2 className="size-4 text-slate-400" />
              </div>
              <p className="mt-2 text-base font-extrabold text-slate-900">
                {status?.modules.length
                  ? `${status.modules.filter((module) => module.status === 'up').length} / ${status.modules.length}`
                  : '—'}
              </p>
            </div>
          </div>
          {status?.error && (
            <div
              role="status"
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
            >
              <p className="max-w-3xl text-xs leading-5 text-amber-900">{status.error}</p>
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
            <p className="mr-1 text-xs font-bold text-slate-500">Quick access</p>
            {OPERATIONS.filter((item) => item.featured).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors',
                  selectedId === item.id
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-700',
                )}
              >
                {item.title}
              </button>
            ))}
          </div>
          <Workbench
            key={`${operation.id}:${selectedConnection}:${connectionEpoch}`}
            operation={operation}
            recent={recent}
            onCompleted={(job) => setRecent((items) => [job, ...items].slice(0, 6))}
            connection={connection}
          />
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-[11px] text-slate-400">
            <span>Gotenui · Stateless document workbench</span>
            <span>TanStack Start · Serverless Gotenberg proxy</span>
          </footer>
        </main>
      </div>
      {features.showDebug && debugOpen && (
        <DebugDialog
          connection={connection}
          connectionName={connectionName}
          onClose={() => setDebugOpen(false)}
          onOpenMetrics={
            features.showMetrics
              ? () => {
                  setDebugOpen(false)
                  setMetricsOpen(true)
                }
              : undefined
          }
        />
      )}
      {features.showMetrics && metricsOpen && (
        <MetricsDialog
          connection={connection}
          connectionName={connectionName}
          onClose={() => setMetricsOpen(false)}
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
      <div className="grid min-h-screen place-items-center bg-[#0c1b2c]">
        <div className="flex items-center gap-3 text-sm font-semibold text-white">
          <RefreshCw className="size-5 animate-spin text-sky-400" /> Opening Gotenui...
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
