import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Clock3,
  FileDown,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { codeOutputClasses } from '#/components/code-output'
import { operationIcon } from '#/components/operation-icons'
import { PdfResultPreview } from '#/components/pdf-result-preview'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { MAX_UPLOAD_BYTES } from '#/lib/gotenberg-client'
import { overlayUploads, type PostProcessFiles } from '#/lib/pdf-post-processing'
import { formatBytes } from '#/lib/security'
import { cn } from '#/lib/utils'
import type { Operation } from '#/tools/registry'
import type { AcceptedWebhook, Download, Job } from '#/tools/shared/tool-jobs'

export function JobPanel({
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
