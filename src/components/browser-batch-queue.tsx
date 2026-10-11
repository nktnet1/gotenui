import {
  ArrowDownToLine,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  FileDown,
  ListPlus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import {
  type BrowserBatchQueue,
  MAX_BATCH_CONCURRENT,
  MAX_BATCH_JOBS,
} from '#/lib/browser-batch-queue'
import { formatBytes } from '#/lib/security'

export function BrowserBatchQueuePanel({ queue }: { queue: BrowserBatchQueue }) {
  const { jobs, active } = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  )
  if (jobs.length === 0) return null
  const queued = jobs.filter((job) => job.status === 'queued').length
  const running = jobs.filter((job) => job.status === 'running').length
  const finished = jobs.filter(
    (job) => !job.aborting && job.status !== 'running' && job.status !== 'queued',
  ).length
  return (
    <section id="gotenui-batch-queue" aria-label="Browser batch queue" className="mt-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ListPlus className="size-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  Batch queue
                </h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {finished} finished · {running} running · {queued} waiting · Up to{' '}
                {MAX_BATCH_CONCURRENT} simultaneous requests
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                <Button type="button" variant="outline" size="sm" onClick={() => queue.pause()}>
                  <CirclePause className="size-4" /> Pause new jobs
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={queued === 0}
                  onClick={() => queue.start()}
                >
                  <CirclePlay className="size-4" /> Start queue
                </Button>
              )}
              <Button
                type="button"
                variant="destructive-outline"
                size="sm"
                disabled={queued + running === 0}
                onClick={() => queue.cancelAll()}
              >
                Cancel waiting/running
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={finished === 0}
                onClick={() => queue.clearFinished()}
              >
                <Trash2 className="size-3.5" /> Clear finished
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Jobs stay in this tab only. Inputs and selected credentials are released after success
            or when a job is cleared. Changing connections will not redirect queued jobs. Downloads
            are available individually after completion. Webhook acceptance is not delivery
            confirmation. Maximum {MAX_BATCH_JOBS} jobs. Pausing does not cancel active requests.
          </p>
          <ul className="space-y-2" aria-label="Queued conversions" aria-live="polite">
            {jobs.map((job) => {
              const runningJob = job.status === 'running'
              const canCancel = runningJob || job.status === 'queued'
              const canRetry =
                !job.aborting && (job.status === 'failed' || job.status === 'cancelled')
              const removable = !job.aborting && !runningJob && job.status !== 'queued'
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/40"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                    {runningJob ? (
                      <RefreshCw className="size-4 animate-spin" />
                    ) : job.status === 'completed' ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : job.status === 'accepted' ? (
                      <Clock3 className="size-4 text-sky-600 dark:text-sky-400" />
                    ) : (
                      <FileDown className="size-4" />
                    )}
                  </div>
                  <div className="min-w-44 flex-1">
                    <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                      #{job.id} · {job.operation}
                    </p>
                    <p className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-400">
                      {job.status === 'queued' && 'Queued'}
                      {runningJob && 'Processing (Gotenberg does not report percentage progress)'}
                      {job.status === 'completed' &&
                        `${job.name} · ${formatBytes(job.size ?? 0)} · ${((job.elapsed ?? 0) / 1000).toFixed(1)}s`}
                      {job.status === 'accepted' &&
                        `Webhook accepted (HTTP ${job.webhookStatus}); delivery unconfirmed`}
                      {job.status === 'cancelled' && (job.aborting ? 'Cancelling...' : 'Cancelled')}
                      {job.status === 'failed' && `Failed: ${job.error ?? 'Unknown error'}`}
                    </p>
                    {job.trace && (
                      <p className="mt-1 break-all text-[10px] text-slate-400">
                        Trace: {job.trace}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.url && job.name && (
                      <a
                        href={job.url}
                        download={job.name}
                        aria-label={`Download ${job.name} from batch job ${job.id}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700"
                      >
                        <ArrowDownToLine className="size-3.5" /> Download
                      </a>
                    )}
                    {canCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Cancel batch job ${job.id}`}
                        onClick={() => queue.cancel(job.id)}
                      >
                        <X className="size-3.5" /> Cancel
                      </Button>
                    )}
                    {canRetry && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Retry batch job ${job.id}`}
                        onClick={() => queue.retry(job.id)}
                      >
                        <RefreshCw className="size-3.5" /> Retry
                      </Button>
                    )}
                    {removable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove batch job ${job.id}`}
                        onClick={() => queue.remove(job.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
