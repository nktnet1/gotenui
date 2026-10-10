import { Braces, ChartNoAxesColumn, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { ConnectionChoice } from '#/lib/connection-profiles'
import { getGotenbergDebug } from '#/lib/gotenberg-client'

type Props = {
  connection: ConnectionChoice
  connectionName: string
  onClose: () => void
  onOpenMetrics: () => void
}

export function DebugDialog({ connection, connectionName, onClose, onOpenMetrics }: Props) {
  const [key, setKey] = useState('')
  const [details, setDetails] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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
        key,
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
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="debug-heading"
        className="relative w-full max-w-[850px] rounded-2xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="debug-heading" className="flex items-center gap-2 text-lg font-extrabold">
              <Braces className="size-5 text-sky-700" /> Debug diagnostics
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
            Gotenberg debug output can contain sensitive runtime configuration. Access is restricted
            by a separate Gotenui administrator key. Your key and the returned data stay in this
            dialog, are not saved, and disappear when you close it. The Gotenberg instance must also
            have API_ENABLE_DEBUG_ROUTE=true.
          </p>
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            Need performance counters instead of runtime configuration?
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onOpenMetrics}>
            <ChartNoAxesColumn className="size-4" /> Prometheus metrics
          </Button>
        </div>
        <form onSubmit={(event) => void inspect(event)} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="debug-access-key">Gotenui debug access key</Label>
            <Input
              id="debug-access-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Administrator access key"
              required
            />
          </div>
          <Button type="submit" disabled={busy || !key}>
            {busy && <RefreshCw className="size-4 animate-spin" />}
            {busy ? 'Reading...' : 'Read debug info'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-800">
            {error}
          </p>
        )}
        {details && (
          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold text-slate-600">
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
