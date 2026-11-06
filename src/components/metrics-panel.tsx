import { ChartNoAxesColumn, ClipboardCopy, Download, RefreshCw } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { codeOutputClasses } from '#/components/code-output'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { getGotenbergMetricsReport } from '#/lib/gotenberg-client'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import { filterPrometheusMetrics, summarizePrometheusMetrics } from '#/lib/prometheus-metrics'
import { cn } from '#/lib/utils'

type Props = {
  connection: ConnectionChoice
  active: boolean
  backendVersion?: string
}

/** Embedded within Diagnostics so Debug and Prometheus share one focus-managed dialog. */
export function MetricsPanel({ connection, active, backendVersion }: Props) {
  const major = parseGotenbergVersion(backendVersion)?.major
  const isV9 = major === 9
  const needsManagedExporter = isV9 && connection.kind === 'browser'
  const [metrics, setMetrics] = useState<string | null>(null)
  const [source, setSource] = useState<'otel' | 'legacy' | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  const summary = useMemo(() => (metrics ? summarizePrometheusMetrics(metrics) : null), [metrics])
  const filtered = useMemo(
    () => (metrics === null ? '' : filterPrometheusMetrics(metrics, filter)),
    [metrics, filter],
  )

  useEffect(() => () => inFlight.current?.abort(), [])
  useEffect(() => {
    if (!active) {
      inFlight.current?.abort()
      setBusy(false)
    }
  }, [active])

  async function readMetrics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true)
    setError(null)
    setMetrics(null)
    setSource(null)
    try {
      const result = await getGotenbergMetricsReport(
        connection,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      if (!controller.signal.aborted) {
        setMetrics(result.text)
        setSource(result.source)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load Gotenberg metrics.')
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null
        setBusy(false)
      }
    }
  }

  async function copyMetrics() {
    if (metrics === null) return
    try {
      await navigator.clipboard.writeText(metrics)
    } catch {
      setError('Clipboard access was denied. Use the download option instead.')
    }
  }

  function downloadMetrics() {
    if (metrics === null) return
    const url = URL.createObjectURL(new Blob([metrics], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'gotenberg-metrics.prom'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revocation happens after the download click, never during render.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Prometheus metrics
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {isV9
              ? 'Gotenberg 9 removed /prometheus/metrics. Use a server-managed connection with a configured OpenTelemetry Prometheus metricsUrl; Gotenui does not discover exporter URLs.'
              : major === 8
                ? 'Gotenberg 8 supports the legacy /prometheus/metrics endpoint. Server-managed connections may instead use a configured OpenTelemetry Prometheus exporter.'
                : 'A Gotenberg 8 connection can read legacy Prometheus metrics. Gotenberg 9 requires a separately configured server-managed OpenTelemetry Prometheus exporter.'}
          </p>
        </div>
        <form className="sm:shrink-0" onSubmit={(event) => void readMetrics(event)}>
          <Button
            type="submit"
            className="w-full sm:w-48"
            disabled={busy || needsManagedExporter}
            aria-busy={busy}
          >
            {busy ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <ChartNoAxesColumn className="size-4" />
            )}
            {busy ? 'Reading…' : metrics ? 'Refresh metrics' : 'Read metrics'}
          </Button>
        </form>
      </div>
      {needsManagedExporter && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300" role="status">
          Browser-managed Gotenberg 9 connections cannot access an exporter through the legacy
          metrics route. Ask the Gotenui administrator to configure a server-managed metricsUrl.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-950/50 px-3 py-3 text-xs text-rose-800 dark:text-rose-200"
        >
          {error}
        </p>
      )}
      {metrics !== null && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
            <span>
              {source === 'otel' ? 'OpenTelemetry exporter' : 'Legacy Prometheus'} ·{' '}
              {summary?.families ?? 0} metric families · {summary?.samples ?? 0} samples
            </span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyMetrics()}>
                <ClipboardCopy className="size-4" /> Copy
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadMetrics}>
                <Download className="size-4" /> Download
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="metrics-filter">Filter metric lines</Label>
            <Input
              id="metrics-filter"
              type="search"
              value={filter}
              placeholder="e.g. chromium or http"
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <pre className={cn(codeOutputClasses, 'max-h-[48vh] min-h-24')}>
            {filtered || 'No matching metric lines.'}
          </pre>
        </div>
      )}
    </div>
  )
}
