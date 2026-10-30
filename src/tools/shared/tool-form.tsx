import {
  ChevronDown,
  Code2,
  ExternalLink,
  FileUp,
  Globe2,
  ListPlus,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RemoteInputsEditor, WebhookEditor } from '#/components/async-inputs-editor'
import { AttachmentMetadataEditor } from '#/components/attachment-metadata-editor'
import {
  ChromiumNetworkEditor,
  type CookieRow,
  type HeaderRow,
} from '#/components/chromium-network-editor'
import { ChromiumPdfAssets } from '#/components/chromium-pdf-assets'
import { ConversionPresets } from '#/components/conversion-presets'
import { HtmlSourceImport } from '#/components/html-source-import'
import { MarkdownAssetsEditor, type MarkdownSource } from '#/components/markdown-assets-editor'
import {
  defaultOverlay,
  OverlayGroupsEditor,
  PdfConversionPostProcessing,
} from '#/components/pdf-conversion-post-processing'
import { PdfBookmarksEditor, PdfMetadataEditor } from '#/components/pdf-structure-editors'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
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
import type { BrowserBatchQueue } from '#/lib/browser-batch-queue'
import { DEFAULT_MARKDOWN_NAME } from '#/lib/chromium-documents'
import { chromiumNetworkFields } from '#/lib/chromium-network'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { convertWithGotenberg, REQUEST_TIMEOUT_MS } from '#/lib/gotenberg-client'
import { OFFICE_ACCEPT } from '#/lib/office-formats'
import { versionAtLeast } from '#/lib/operation-availability'
import {
  type OverlayKind,
  overlayUploads,
  PDF_POST_PROCESS_IDS,
  type PdfPostProcess,
  type PostProcessFiles,
} from '#/lib/pdf-post-processing'
import { importReadableBookmarks, importReadableMetadata } from '#/lib/pdf-read-import'
import { cn } from '#/lib/utils'
import { InputError, parseAdvanced } from '#/lib/validation'
import {
  activeOperationFields,
  type FieldDefinition,
  isFieldVisible,
  type Operation,
  operationDefaults,
} from '#/tools/registry'
import { JobPanel } from '#/tools/shared/job-panel'
import { FieldControl } from '#/tools/shared/tool-fields'
import type { AcceptedWebhook, Download, Job } from '#/tools/shared/tool-jobs'

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

export function Workbench({
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
