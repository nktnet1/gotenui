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
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { PdfPipelineBuilder } from '#/components/pdf-pipeline-builder'
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
import {
  convertWithGotenberg,
  REQUEST_TIMEOUT_MS,
  remediationReviewNotice,
} from '#/lib/gotenberg-client'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import { officeAcceptForVersion } from '#/lib/office-formats'
import { canWebhookForOperation } from '#/lib/operation-availability'
import { DEFAULT_PDF_PIPELINE } from '#/lib/pdf-pipeline'
import { pdfPipelineEditorError } from '#/lib/pdf-pipeline-editor-validation'
import {
  type OverlayKind,
  overlayUploads,
  PDF_POST_PROCESS_IDS,
  type PdfPostProcess,
  type PostProcessFiles,
} from '#/lib/pdf-post-processing'
import { importReadableBookmarks, importReadableMetadata } from '#/lib/pdf-read-import'
import { summarisePdfValidationBlob } from '#/lib/pdf-validation-report'
import { cn } from '#/lib/utils'
import {
  InputError,
  parseAdvanced,
  supportsArchiveInputs,
  type WebhookConfig,
} from '#/lib/validation'
import {
  activeOperationFields,
  type FieldDefinition,
  fieldSupportsBackend,
  isFieldVisible,
  type Operation,
  operationDefaults,
} from '#/tools/registry'
import { draftCompatibility, draftOutboundIssues } from '#/tools/shared/draft-compatibility'
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
  backendVersion: verifiedVersion,
  connectionKey,
  connectionName,
  recent,
  onCompleted,
  connection,
  batchQueue,
}: {
  operation: Operation
  unavailableReason: string | null
  backendVersion?: string
  connectionKey: string
  connectionName: string
  recent: Job[]
  onCompleted: (job: Job) => void
  connection: ConnectionChoice
  batchQueue: BrowserBatchQueue
}) {
  // Keep the last confirmed layout while the current connection is being verified.
  const [lastVerifiedVersion, setLastVerifiedVersion] = useState(verifiedVersion)
  useLayoutEffect(() => {
    if (verifiedVersion) setLastVerifiedVersion(verifiedVersion)
  }, [verifiedVersion])
  const backendVersion = verifiedVersion ?? lastVerifiedVersion
  const [approvedConnectionKey, setApprovedConnectionKey] = useState(connectionKey)
  const transferPending = approvedConnectionKey !== connectionKey
  const actionUnavailable =
    unavailableReason ??
    (!verifiedVersion ? 'Verify the selected Gotenberg version before running tools.' : null)
  const submissionBlocked =
    actionUnavailable ??
    (transferPending ? 'Confirm that this draft may be sent to the selected connection.' : null)
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
  const [conversionStages, setConversionStages] = useState('')
  const [conversionStageFiles, setConversionStageFiles] = useState<File[]>([])
  const [acknowledgedConversionRedaction, setAcknowledgedConversionRedaction] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [archives, setArchives] = useState<File[]>([])
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
  // Keep the draft across connections, but never publish a previous connection's
  // in-flight result in the new workspace. Queued jobs retain their own targets.
  const previousConnectionKey = useRef(connectionKey)
  useLayoutEffect(() => {
    if (previousConnectionKey.current === connectionKey) return
    previousConnectionKey.current = connectionKey
    requestAbort.current?.abort()
    requestAbort.current = null
    readAbort.current?.abort()
    readAbort.current = null
    setPending(false)
    setReadingStructure(false)
    clearResult()
  }, [connectionKey, clearResult])
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
    setConversionStages('')
    setConversionStageFiles([])
    setAcknowledgedConversionRedaction(false)
    setFiles([])
    setArchives([])
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
  const hasMetadataEditor = operation.fields.some(
    (field) => field.name === 'metadata' && fieldSupportsBackend(field, backendVersion),
  )
  const hasBookmarksEditor = operation.fields.some(
    (field) => field.name === 'bookmarks' && fieldSupportsBackend(field, backendVersion),
  )
  const hasPdfStructureEditor = hasMetadataEditor || hasBookmarksEditor || operation.id === 'embed'
  const layoutMajor = parseGotenbergVersion(backendVersion)?.major
  const isV9 = layoutMajor === 9
  const isV8 = layoutMajor === 8
  const canWebhook = (isV8 || isV9) && canWebhookForOperation(layoutMajor, operation)
  const canUploadArchives = isV9 && supportsArchiveInputs(operation)
  const v8StandaloneOverlay = Boolean(standaloneKind) && isV8
  const basicFields = v8StandaloneOverlay
    ? []
    : operation.fields.filter(
        (field) =>
          !field.advanced &&
          fieldSupportsBackend(field, backendVersion) &&
          !field.section &&
          isFieldVisible(field, fields) &&
          !(field.customEditor && field.kind === 'json') &&
          !(operation.id === 'embed' && field.name === 'embedsMetadata') &&
          !(
            operation.id === 'pdf-pipeline' &&
            ['stages', 'acknowledgedRedaction'].includes(field.name)
          ),
      )
  const advancedFields = v8StandaloneOverlay
    ? []
    : operation.fields.filter(
        (field) =>
          field.advanced &&
          fieldSupportsBackend(field, backendVersion) &&
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
  const hasPostProcessing = PDF_POST_PROCESS_IDS.has(operation.id) && isV8
  const supportsConversionPipeline = isV9 && operation.output === 'pdf' && operation.input !== 'pdf'
  const hasChromiumNetwork = operation.path.startsWith('/forms/chromium/')
  const compatibility = draftCompatibility(operation, fields, verifiedVersion, {
    legacyStandaloneOverlay: v8StandaloneOverlay,
    acceptsPostProcess: v8StandaloneOverlay || hasPostProcessing,
    postProcess,
    postFiles,
    acceptsArchives: canUploadArchives,
    archives,
    acceptsWebhook: canWebhook,
    webhookConfigured: webhookSettings.enabled || Boolean(webhookInput.trim()),
    acceptsConversionStages: supportsConversionPipeline,
    conversionStages,
    conversionStageFiles,
    auxiliary: auxFiles,
  })
  const outboundIssues = draftOutboundIssues(operation, fields, verifiedVersion, {
    remoteRows,
    remoteInput,
    webhookSettings,
    webhookInput,
    advanced,
  })
  const discardIncompatibleSettings = () => {
    if (actionUnavailable || pending) return
    setFields((current) => {
      const next = { ...current }
      const defaults = operationDefaults(operation)
      for (const { name } of compatibility.fieldConflicts) {
        const defaultValue = defaults[name]
        if (defaultValue === undefined) delete next[name]
        else next[name] = defaultValue
      }
      return next
    })
    if (compatibility.discardPostProcess) {
      setPostProcess({})
      setPostFiles({})
    }
    if (compatibility.discardArchives) setArchives([])
    if (compatibility.discardWebhook) {
      setWebhookSettings(emptyWebhook)
      setWebhookInput('')
    }
    if (compatibility.discardStages) {
      setConversionStages('')
      setConversionStageFiles([])
      setAcknowledgedConversionRedaction(false)
    }
    if (compatibility.discardAuxiliary) setAuxFiles([])
  }
  const remotePipelineInputs = { remoteRows, remoteJson: remoteInput }
  const pipelineError =
    operation.id === 'pdf-pipeline'
      ? pdfPipelineEditorError(String(fields.stages ?? ''), {
          ...remotePipelineInputs,
          localAssetNames: auxFiles.map(({ name }) => name),
          archivesPresent: archives.length > 0,
          acknowledgedRedaction: fields.acknowledgedRedaction === true,
          backendVersion,
          documentNames: files.map(({ name }) => name),
          documentKind: 'pdf',
        })
      : null
  const conversionPipelineError =
    conversionStages || conversionStageFiles.length
      ? pdfPipelineEditorError(conversionStages, {
          ...remotePipelineInputs,
          localAssetNames: conversionStageFiles.map(({ name }) => name),
          archivesPresent: archives.length > 0,
          acknowledgedRedaction: acknowledgedConversionRedaction,
          backendVersion,
          documentNames: files.map(({ name }) => name),
          documentKind: operation.id === 'office-pdf' ? 'office' : 'single',
          builtInMerge: operation.id === 'office-pdf' && fields.merge === true,
          outputName: outputName.trim() || undefined,
        })
      : null
  const docsUrl =
    isV9 && operation.input === 'pdf'
      ? `https://gotenberg.dev/docs/pdf/${operation.id === 'extract-attachments' ? 'attachments' : operation.id === 'extract-text' ? 'pages' : operation.id === 'metadata-read' ? 'metadata' : operation.id === 'bookmarks-read' ? 'bookmarks' : 'pipe'}`
      : `https://gotenberg.dev/docs/${operation.docs}`

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
    if (submissionBlocked) {
      toast.error(submissionBlocked)
      return
    }
    const controller = new AbortController()
    readAbort.current = controller
    setReadingStructure(true)
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const result = await convertWithGotenberg(
        connection,
        {
          operation: metadata ? 'metadata-read' : 'bookmarks-read',
          expectedBackendVersion: verifiedVersion,
          fields: {},
          advanced: {},
        },
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
      if (signal.aborted) return
      const editable = metadata
        ? importReadableMetadata(content, files[0]?.name ?? '', { standardOnly: isV9 })
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
    if (submissionBlocked) throw new InputError(submissionBlocked)
    const issues = [...compatibility.reasons, ...outboundIssues]
    if (issues.length) throw new InputError(issues.join(' '))
    const downloadFrom = remoteInputsPayload(remoteRows, remoteInput)
    const webhook = !canWebhook
      ? undefined
      : (webhookPayload(webhookSettings, webhookInput) as WebhookConfig | undefined)
    if (pipelineError) throw new InputError(pipelineError)
    if (conversionPipelineError) throw new InputError(conversionPipelineError)
    const selectedFields = activeOperationFields(operation, fields, backendVersion)
    const candidate = {
      operation: operation.id,
      expectedBackendVersion: verifiedVersion,
      fields: v8StandaloneOverlay
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
      conversionStages: supportsConversionPipeline ? conversionStages || undefined : undefined,
      acknowledgedConversionRedaction:
        supportsConversionPipeline && conversionStages
          ? acknowledgedConversionRedaction
          : undefined,
      postProcess: v8StandaloneOverlay
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
    if (submissionBlocked) {
      toast.error(submissionBlocked)
      return
    }
    try {
      const id = batchQueue.enqueue({
        connection,
        candidate: buildCandidate(),
        files,
        archives: canUploadArchives ? archives : [],
        auxiliary: auxFiles,
        stageFiles: supportsConversionPipeline ? conversionStageFiles : [],
        postFiles: v8StandaloneOverlay || !standaloneKind ? postFiles : {},
      })
      toast.success(`Added job #${id} to the batch queue below.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the job.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || requestAbort.current) return
    if (submissionBlocked) {
      toast.error(submissionBlocked)
      return
    }
    const controller = new AbortController()
    requestAbort.current = controller
    setPending(true)
    setAcceptedWebhook(null)
    try {
      const candidate = buildCandidate()
      const webhook = candidate.webhook
      const start = performance.now()
      const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = AbortSignal.any([controller.signal, deadline])
      const result = await convertWithGotenberg(
        connection,
        candidate,
        files,
        auxFiles,
        signal,
        v8StandaloneOverlay || !standaloneKind ? postFiles : {},
        supportsConversionPipeline ? conversionStageFiles : [],
        canUploadArchives ? archives : [],
      )
      if (signal.aborted) {
        if (deadline.aborted) toast.error('Gotenberg did not respond within three minutes.')
        return
      }
      if (result.mode === 'webhook') {
        setAcceptedWebhook({
          status: result.status,
          trace: result.trace,
          receiverHost: safeOutboundHost(webhook?.url ?? ''),
          ...(webhook?.eventsUrl
            ? { eventsReceiverHost: safeOutboundHost(webhook.eventsUrl) }
            : {}),
        })
        setLastDownload(null)
        if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
        fileUrl.current = null
        toast.message('Gotenberg accepted the request; callback delivery is not yet confirmed.')
        return
      }
      const { blob, type, name, trace, remediation } = result
      const preview = ['application/json', 'text/plain'].includes(type)
        ? await blob.slice(0, 16_000).text()
        : undefined
      const validation =
        operation.id === 'pdf-validate'
          ? ((await summarisePdfValidationBlob(blob)) ?? undefined)
          : undefined
      if (signal.aborted) return
      const url = URL.createObjectURL(blob)
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
      fileUrl.current = url
      setLastDownload({
        name,
        size: blob.size,
        type,
        url,
        blob: type === 'application/zip' ? blob : undefined,
        preview,
        trace,
        remediation,
        validation,
      })
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
      if (validation?.some((result) => !result.compliant)) {
        toast.warning(
          'PDF validation found non-compliant documents. Review the reported violations before relying on them.',
        )
      } else if (validation?.some((result) => result.totalViolations > 0)) {
        toast.warning(
          'PDF validation found non-fatal findings in compliant documents. Review the downloaded JSON report.',
        )
      } else if (operation.id === 'pdf-validate' && !validation) {
        toast.warning(
          'PDF validation response could not be summarised. Review the downloaded JSON.',
        )
      } else if (remediationReviewNotice(remediation)) {
        toast.warning(`Gotenberg generated ${name}, but ${remediationReviewNotice(remediation)}`)
      } else toast.success(`${name} is ready to download`)
    } catch (error) {
      if (requestAbort.current !== controller) return
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
      if (requestAbort.current === controller) {
        requestAbort.current = null
        setPending(false)
      }
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
            {actionUnavailable && (
              <p
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                {actionUnavailable} Choose another tool or connection.
              </p>
            )}
            {transferPending && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                <p className="font-medium">Review retained draft before using {connectionName}.</p>
                <p>
                  {connection.kind === 'browser' && (
                    <>Destination: {safeOutboundHost(connection.url)}. </>
                  )}
                  The draft may contain documents, source content, passwords, cookies,
                  authentication headers, remote downloads or webhook settings. Review them before
                  sending the draft to this connection. Existing queued jobs keep their original
                  connection.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!verifiedVersion}
                  onClick={() => setApprovedConnectionKey(connectionKey)}
                >
                  Confirm draft for this connection
                </Button>
              </div>
            )}
            {outboundIssues.length > 0 && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                <p className="font-medium">
                  Review remote files, webhook settings or Advanced JSON.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {[...new Set(outboundIssues)].map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p>Correct the settings below or select a compatible connection.</p>
              </div>
            )}
            {compatibility.reasons.length > 0 && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                <p className="font-medium">
                  The selected connection cannot run all configured settings.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {compatibility.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p>
                  Switch back to a compatible connection or discard only the incompatible settings
                  before running or queuing this operation.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || Boolean(actionUnavailable)}
                  onClick={discardIncompatibleSettings}
                >
                  Discard incompatible settings
                </Button>
              </div>
            )}
            {hasUpload && (
              <UploadZone
                label={
                  operation.input === 'pdf' ? 'Upload PDF documents' : 'Upload Office documents'
                }
                description={
                  operation.id === 'merge'
                    ? isV9
                      ? 'Select one or more PDFs. Gotenberg 9 also accepts a single PDF. Gotenui prefixes filenames to preserve the selected order when merging multiple files.'
                      : 'Select at least two PDFs. Gotenui prefixes uploaded filenames to preserve the order shown below.'
                    : operation.input === 'pdf'
                      ? 'Select PDF files to process. Multiple files may produce a ZIP archive.'
                      : 'Documents, slides, spreadsheets, drawings and images supported by Gotenberg.'
                }
                files={files}
                onChange={(nextFiles) => {
                  readAbort.current?.abort()
                  setFiles(nextFiles)
                }}
                accept={
                  operation.input === 'pdf'
                    ? '.pdf,application/pdf'
                    : officeAcceptForVersion(backendVersion)
                }
                multiple={true}
                reorder={
                  operation.id === 'merge' ||
                  (operation.id === 'office-pdf' && fields.merge === true)
                }
                allowDuplicateNames={
                  (isV9 && (operation.input === 'pdf' || operation.input === 'office')) ||
                  operation.id === 'merge' ||
                  (operation.id === 'office-pdf' && fields.merge === true)
                }
              />
            )}
            {canUploadArchives && (
              <UploadZone
                label={
                  operation.input === 'office'
                    ? 'Office ZIP archives'
                    : operation.input === 'pdf'
                      ? 'PDF ZIP archives'
                      : 'Asset ZIP archives'
                }
                description={
                  operation.input === 'office'
                    ? 'ZIP archives of Office documents and any named PDF stage assets. Gotenberg extracts the inputs and enforces expansion limits; multiple outputs may return as a ZIP.'
                    : operation.input === 'pdf'
                      ? 'ZIP archives of PDFs and, for the pipeline, referenced stage assets. PDFs inside archives count as input documents. Gotenberg enforces extraction limits.'
                      : 'Optional ZIP archives of named assets used by this route or conversion pipeline. HTML/Markdown assets must not shadow index.html, header.html or footer.html.'
                }
                files={archives}
                onChange={setArchives}
                multiple
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
            {operation.auxiliary && !v8StandaloneOverlay && (
              <UploadZone
                label={operation.auxiliary.label}
                description={operation.auxiliary.description}
                files={auxFiles}
                onChange={updateAux}
                multiple={operation.auxiliary.multiple}
                accept={
                  (isV9 && operation.id === 'factur-x') ||
                  (isV9 && standaloneKind && fields[`${standaloneKind}Source`] === 'pdf')
                    ? undefined
                    : operation.auxiliary.accept
                }
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
            ) : !v8StandaloneOverlay &&
              !hasPdfStructureEditor &&
              operation.id !== 'pdf-pipeline' ? (
              <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                This operation works with its default settings.
              </p>
            ) : null}
            {operation.id === 'pdf-pipeline' && (
              <PdfPipelineBuilder
                key={operation.id}
                value={String(fields.stages ?? '')}
                onChange={(value) => updateField('stages', value)}
                acknowledgedRedaction={fields.acknowledgedRedaction === true}
                onRedactionChange={(value) => updateField('acknowledgedRedaction', value)}
                error={pipelineError}
              />
            )}
            {(operation.id === 'metadata-write' || operation.id === 'bookmarks-write') && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    pending ||
                    readingStructure ||
                    Boolean(submissionBlocked) ||
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
            {hasMetadataEditor && isV9 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gotenberg 9 writes standard PDF metadata (title, author, subject, keywords, creator,
                producer, and dates). Custom XMP fields such as Copyright remain available only with
                Gotenberg 8.
              </p>
            )}
            {hasMetadataEditor && (
              <PdfMetadataEditor
                standardOnly={isV9}
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
                allowFilenameMap={!isV9}
                filenames={files.map((file) => file.name)}
              />
            )}
            {v8StandaloneOverlay && standaloneKind && activeStandaloneSettings && (
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
            {supportsConversionPipeline && (
              <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      PDF processing after conversion (Gotenberg 9)
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      Apply ordered PDF stages in the same conversion request. Office merge and
                      split controls run first; automatic PDF/A remediation runs last. Gotenberg 8
                      retains its separate post-processing controls.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={Boolean(conversionStages)}
                    onClick={() => {
                      setConversionStages(conversionStages ? '' : DEFAULT_PDF_PIPELINE)
                      setConversionStageFiles([])
                      setAcknowledgedConversionRedaction(false)
                    }}
                  >
                    {conversionStages ? 'Remove pipeline' : 'Add pipeline'}
                  </Button>
                </div>
                {conversionStages && (
                  <div className="space-y-4">
                    <PdfPipelineBuilder
                      value={conversionStages}
                      onChange={setConversionStages}
                      acknowledgedRedaction={acknowledgedConversionRedaction}
                      onRedactionChange={setAcknowledgedConversionRedaction}
                      error={conversionPipelineError}
                      conversionMode
                    />
                    <UploadZone
                      label="Pipeline stage files"
                      description="Upload named PDFs, PNG/JPEG stamps, invoices, attachments, or signing credentials. Reference each exact filename in its stage settings."
                      files={conversionStageFiles}
                      onChange={setConversionStageFiles}
                      multiple
                    />
                  </div>
                )}
              </section>
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
              const items = operation.fields.filter(
                (field) => field.section === key && fieldSupportsBackend(field, backendVersion),
              )
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
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {operation.output === 'json'
                  ? 'Names the browser download. Gotenberg metadata responses do not support the output filename header.'
                  : 'Names generated downloads using Gotenberg-Output-Filename, with the extension added automatically. Individually extracted attachments keep their original filenames instead.'}
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
                        field={
                          isV9 && operation.id === 'factur-x' && field.name === 'pdfa'
                            ? { ...field, options: ['PDF/A-3b'] }
                            : field
                        }
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
                {operation.id !== 'pdf-pipeline' && (
                  <div className="space-y-2">
                    <Label htmlFor="additional-fields">
                      Additional Gotenberg form fields (JSON)
                    </Label>
                    <Textarea
                      id="additional-fields"
                      rows={4}
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder="{}"
                      value={advanced}
                      onChange={(event) => setAdvanced(event.target.value)}
                    />
                    <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                      Use this for documented options not shown above. Enter flat JSON key/value
                      pairs; enter remote inputs and webhooks separately below.
                    </p>
                  </div>
                )}
                <RemoteInputsEditor
                  isV9={isV9}
                  backendVersion={backendVersion}
                  pdfInputOnly={operation.id === 'pdf-pipeline'}
                  rows={remoteRows}
                  onChange={setRemoteRows}
                  legacy={remoteInput}
                  onLegacyChange={setRemoteInput}
                  newId={() => nextOutboundId.current++}
                />
                {!canWebhook ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {layoutMajor === undefined
                      ? 'Webhook options will be available after the backend version is verified.'
                      : 'PDF inspection returns JSON directly on Gotenberg 9, so webhook delivery is not available for this tool.'}
                  </p>
                ) : (
                  <WebhookEditor
                    isV9={isV9}
                    value={webhookSettings}
                    onChange={setWebhookSettings}
                    legacy={webhookInput}
                    onLegacyChange={setWebhookInput}
                    newId={() => nextOutboundId.current++}
                  />
                )}
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
              disabled={
                pending ||
                Boolean(submissionBlocked) ||
                compatibility.reasons.length > 0 ||
                outboundIssues.length > 0 ||
                Boolean(pipelineError || conversionPipelineError)
              }
              onClick={queueCurrent}
            >
              <ListPlus className="size-4" /> Add to batch
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={
                pending ||
                Boolean(submissionBlocked) ||
                compatibility.reasons.length > 0 ||
                outboundIssues.length > 0 ||
                Boolean(pipelineError || conversionPipelineError)
              }
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
        backendVersion={backendVersion}
        operation={operation}
        files={files}
        auxFiles={auxFiles}
        postFiles={v8StandaloneOverlay || !standaloneKind ? postFiles : {}}
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
