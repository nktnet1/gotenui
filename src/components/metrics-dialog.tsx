import { ChartNoAxesColumn, ClipboardCopy, Download, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { getGotenbergMetrics } from '#/lib/gotenberg-client'
import { filterPrometheusMetrics, summarizePrometheusMetrics } from '#/lib/prometheus-metrics'

type Props = {
  connection: ConnectionChoice
  connectionName: string
  onClose: () => void
}

export function MetricsDialog({ connection, connectionName, onClose }: Props) {
  const [metrics, setMetrics] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const summary = useMemo(() => (metrics ? summarizePrometheusMetrics(metrics) : null), [metrics])
  const filtered = useMemo(
    () => (metrics === null ? '' : filterPrometheusMetrics(metrics, filter)),
    [metrics, filter],
  )

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('keydown', onEscape)
      inFlight.current?.abort()
    }
  }, [])

  async function readMetrics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true)
    setError(null)
    setMetrics(null)
    try {
      const text = await getGotenbergMetrics(
        connection,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      if (!controller.signal.aborted) setMetrics(text)
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-5 pt-[7vh]">
      <button
        type="button"
        aria-label="Close metrics"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="metrics-heading"
        className="relative w-full max-w-[850px] rounded-2xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="metrics-heading" className="flex items-center gap-2 text-lg font-extrabold">
              <ChartNoAxesColumn className="size-5 text-sky-700" /> Prometheus metrics
            </h2>
            <p className="mt-1 text-xs text-slate-500">Selected instance: {connectionName}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        <div className="mb-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
          <ShieldAlert className="size-5 shrink-0" />
          <p>
            Metrics may reveal internal instance details. Gotenui relies on the selected Gotenberg
            instance to control access to /prometheus/metrics. This legacy endpoint is deprecated in
            favour of OpenTelemetry. Responses are kept in memory only.
          </p>
        </div>
        <form onSubmit={(event) => void readMetrics(event)}>
          <Button type="submit" disabled={busy}>
            {busy && <RefreshCw className="size-4 animate-spin" />}
            {busy ? 'Reading...' : metrics ? 'Refresh metrics' : 'Read metrics'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-800">
            {error}
          </p>
        )}
        {metrics !== null && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                {summary?.families ?? 0} metric families · {summary?.samples ?? 0} samples
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyMetrics()}
                >
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
            <pre className="max-h-[48vh] min-h-24 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 whitespace-pre text-slate-100">
              {filtered || 'No matching metric lines.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
