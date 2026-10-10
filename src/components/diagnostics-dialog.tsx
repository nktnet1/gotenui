import { Activity, Braces, ChartNoAxesColumn, RefreshCw, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { useModalFocus } from '#/components/use-modal-focus'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { getGotenbergDebug, probeGotenbergHealth } from '#/lib/gotenberg-client'
import { cn } from '#/lib/utils'

type Props = {
  connection: ConnectionChoice
  connectionName: string
  onClose: () => void
  showDebug: boolean
  onOpenMetrics?: () => void
}

export function DiagnosticsDialog({
  connection,
  connectionName,
  onClose,
  showDebug,
  onOpenMetrics,
}: Props) {
  const [probeResult, setProbeResult] = useState<'healthy' | 'unhealthy' | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const probeInFlight = useRef<AbortController | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  const dialogRef = useModalFocus(onClose)

  useEffect(
    () => () => {
      inFlight.current?.abort()
      probeInFlight.current?.abort()
    },
    [],
  )

  async function probeHealth() {
    probeInFlight.current?.abort()
    const controller = new AbortController()
    probeInFlight.current = controller
    setProbing(true)
    setProbeError(null)
    setProbeResult(null)
    try {
      const healthy = await probeGotenbergHealth(
        connection,
        AbortSignal.any([controller.signal, AbortSignal.timeout(7_000)]),
      )
      if (!controller.signal.aborted) setProbeResult(healthy ? 'healthy' : 'unhealthy')
    } catch (cause) {
      if (!controller.signal.aborted) {
        setProbeError(cause instanceof Error ? cause.message : 'Health probe failed.')
      }
    } finally {
      if (probeInFlight.current === controller) {
        probeInFlight.current = null
        setProbing(false)
      }
    }
  }

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true)
    setError(null)
    setDetails(null)
    try {
      const payload = await getGotenbergDebug(
        connection,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      if (!controller.signal.aborted) setDetails(JSON.stringify(payload, null, 2))
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load debug diagnostics.')
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null
        setBusy(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-5 pt-[7vh]">
      <button
        type="button"
        aria-label="Close diagnostics"
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
        aria-labelledby="diagnostics-heading"
        className="relative w-full max-w-[850px] rounded-2xl bg-white dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100 shadow-2xl sm:p-8"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="diagnostics-heading" className="flex items-center gap-2 text-lg font-extrabold">
              <Activity className="size-5 text-sky-700 dark:text-sky-300" /> Diagnostics
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Selected instance: {connectionName}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        <section
          className="mb-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4"
          aria-label="Health probe"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">HEAD /health</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Check whether this Gotenberg instance reports healthy (200) or unhealthy (503).
              </p>
            </div>
            <Button
              type="button"
              variant="accent"
              disabled={probing}
              onClick={() => void probeHealth()}
            >
              <Activity className={probing ? 'size-4 animate-pulse' : 'size-4'} />
              {probing ? 'Probing…' : 'Run health probe'}
            </Button>
          </div>
          {probeResult && (
            <p
              role="status"
              className={cn(
                'mt-3 text-xs font-semibold',
                probeResult === 'healthy'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-800 dark:text-amber-300',
              )}
            >
              {probeResult === 'healthy' ? '200 — Healthy' : '503 — Unhealthy'}
            </p>
          )}
          {probeError && (
            <p role="alert" className="mt-3 text-xs text-rose-800 dark:text-rose-200">
              {probeError}
            </p>
          )}
        </section>
        {onOpenMetrics && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {showDebug
                ? 'Need performance counters instead of runtime configuration?'
                : 'View performance counters for this instance.'}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onOpenMetrics}>
              <ChartNoAxesColumn className="size-4" /> Prometheus metrics
            </Button>
          </div>
        )}
        {showDebug && (
          <form onSubmit={(event) => void inspect(event)}>
            <Button type="submit" disabled={busy}>
              {busy && <RefreshCw className="size-4 animate-spin" />}
              <Braces className="size-4" />
              {busy ? 'Reading...' : 'Read debug info'}
            </Button>
          </form>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-950/50 px-3 py-3 text-xs text-rose-800 dark:text-rose-200"
          >
            {error}
          </p>
        )}
        {details && (
          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Runtime configuration (read-only)
            </p>
            <pre className="max-h-[50vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 whitespace-pre text-slate-100">
              {details}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
