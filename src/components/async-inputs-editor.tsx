import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import {
  type ExtraHeaderRow,
  type RemoteInputRow,
  safeOutboundHost,
  type WebhookEditorState,
} from '#/lib/async-inputs'

function ExtraHeaders({
  rows,
  onChange,
  newId,
  context,
}: {
  rows: ExtraHeaderRow[]
  onChange: (rows: ExtraHeaderRow[]) => void
  newId: () => number
  context: string
}) {
  const id = useId()
  const update = (index: number, patch: Partial<ExtraHeaderRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
          Optional outbound headers ({rows.length}/20)
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= 20}
          onClick={() => onChange([...rows, { id: newId(), name: '', value: '' }])}
        >
          <Plus className="size-3.5" /> Add header
        </Button>
      </div>
      {rows.map((row, index) => (
        <div key={row.id} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor={`${id}-header-name-${row.id}`}>Name</Label>
            <Input
              id={`${id}-header-name-${row.id}`}
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
              placeholder="X-Api-Key"
              autoComplete="off"
              maxLength={80}
            />
          </div>
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor={`${id}-header-value-${row.id}`}>Value (hidden)</Label>
            <Input
              id={`${id}-header-value-${row.id}`}
              type="password"
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
              autoComplete="new-password"
              placeholder="Secret or header value"
              maxLength={2000}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${context} header ${index + 1}`}
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {rows.length > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Header values are sent to the destination, never shown in previews or saved by Gotenui.
        </p>
      )}
    </div>
  )
}

export function RemoteInputsEditor({
  rows,
  onChange,
  legacy,
  onLegacyChange,
  newId,
}: {
  rows: RemoteInputRow[]
  onChange: (rows: RemoteInputRow[]) => void
  legacy: string
  onLegacyChange: (value: string) => void
  newId: () => number
}) {
  const id = useId()
  const update = (index: number, patch: Partial<RemoteInputRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  const move = (from: number, to: number) => {
    const changed = [...rows]
    const [selected] = changed.splice(from, 1)
    if (selected) changed.splice(to, 0, selected)
    onChange(changed)
  }
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Remote file inputs
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Gotenberg fetches files from these URLs directly.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= 20 || !!legacy.trim()}
          onClick={() => onChange([...rows, { id: newId(), url: '', field: '', headers: [] }])}
        >
          <Plus className="size-3.5" /> Add remote file
        </Button>
      </div>
      {rows.map((row, index) => (
        <div
          key={row.id}
          className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Remote file {index + 1}
            </h4>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move remote file ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move remote file ${index + 1} down`}
                disabled={index === rows.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(rows.filter((_, position) => position !== index))}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-remote-url-${row.id}`}>File URL</Label>
            <Input
              id={`${id}-remote-url-${row.id}`}
              type="url"
              value={row.url}
              onChange={(event) => update(index, { url: event.target.value })}
              placeholder="https://files.example.com/report.pdf"
              autoComplete="off"
              maxLength={2048}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-remote-field-${row.id}`}>Destination field</Label>
            <select
              id={`${id}-remote-field-${row.id}`}
              className="h-11 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-800 dark:text-slate-100"
              value={row.field}
              onChange={(event) =>
                update(index, { field: event.target.value as RemoteInputRow['field'] })
              }
            >
              <option value="">Regular conversion input / HTML asset</option>
              <option value="embedded">PDF attachment (embedded)</option>
              <option value="watermark">PDF watermark asset</option>
              <option value="stamp">PDF stamp asset</option>
            </select>
          </div>
          <ExtraHeaders
            rows={row.headers}
            onChange={(headers) => update(index, { headers })}
            newId={newId}
            context={`remote file ${index + 1}`}
          />
          {row.url && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Preview: {safeOutboundHost(row.url)} · {row.field || 'regular input'} ·{' '}
              {row.headers.length} header(s) (values hidden)
            </p>
          )}
        </div>
      ))}
      <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        Each download response <strong>must</strong> include Content-Disposition with a filename and
        a valid Content-Type. Gotenberg must be able to reach the URL and allow it through its
        outbound filtering. Watermark/stamp filenames must match their editor expressions; remote
        overlays precede local overlays of that type. Remote merge files are sorted by filename by
        Gotenberg.
      </p>
      <details className="text-xs text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-semibold">
          Legacy downloadFrom JSON (optional)
        </summary>
        <div className="mt-2 space-y-1">
          <Label htmlFor={`${id}-remote-json`}>Raw descriptor array — alternative to rows</Label>
          <Textarea
            id={`${id}-remote-json`}
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={'[{"url":"https://example.com/file.docx"}]'}
            value={legacy}
            onChange={(event) => onLegacyChange(event.target.value)}
          />
          <p>
            Choose rows or JSON, never both. JSON may contain secrets; it is not used in previews.
          </p>
        </div>
      </details>
    </section>
  )
}

export function WebhookEditor({
  value,
  onChange,
  legacy,
  onLegacyChange,
  newId,
}: {
  value: WebhookEditorState
  onChange: (value: WebhookEditorState) => void
  legacy: string
  onLegacyChange: (value: string) => void
  newId: () => number
}) {
  const id = useId()
  const update = (patch: Partial<WebhookEditorState>) => onChange({ ...value, ...patch })
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Asynchronous webhook delivery
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Gotenberg sends output to your external receiver.
          </p>
        </div>
        <Switch
          aria-label="Enable asynchronous webhook delivery"
          checked={value.enabled}
          disabled={!!legacy.trim()}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </div>
      {value.enabled && (
        <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
            <div className="space-y-1">
              <Label htmlFor={`${id}-success-url`}>Success callback URL (required)</Label>
              <Input
                id={`${id}-success-url`}
                type="url"
                value={value.url}
                onChange={(event) => update({ url: event.target.value })}
                placeholder="https://hooks.example.com/success"
                autoComplete="off"
                maxLength={2048}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-success-method`}>Method</Label>
              <select
                id={`${id}-success-method`}
                className="h-11 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-800 dark:text-slate-100"
                value={value.method}
                onChange={(event) =>
                  update({ method: event.target.value as WebhookEditorState['method'] })
                }
              >
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
            <div className="space-y-1">
              <Label htmlFor={`${id}-error-url`}>
                Error callback URL (optional, deprecated upstream)
              </Label>
              <Input
                id={`${id}-error-url`}
                type="url"
                value={value.errorUrl}
                onChange={(event) => update({ errorUrl: event.target.value })}
                placeholder="https://hooks.example.com/error"
                autoComplete="off"
                maxLength={2048}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-error-method`}>Method</Label>
              <select
                id={`${id}-error-method`}
                className="h-11 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-800 dark:text-slate-100 disabled:opacity-50"
                value={value.errorMethod}
                disabled={!value.errorUrl.trim()}
                onChange={(event) =>
                  update({ errorMethod: event.target.value as WebhookEditorState['errorMethod'] })
                }
              >
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-events-url`}>Structured events URL (recommended)</Label>
            <Input
              id={`${id}-events-url`}
              type="url"
              value={value.eventsUrl}
              onChange={(event) => update({ eventsUrl: event.target.value })}
              placeholder="https://hooks.example.com/events"
              autoComplete="off"
              maxLength={2048}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Events always use POST. Configure an error or events URL to receive failure details.
            </p>
          </div>
          <ExtraHeaders
            rows={value.headers}
            onChange={(headers) => update({ headers })}
            newId={newId}
            context="webhook"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Preview: success {safeOutboundHost(value.url)} · error{' '}
            {value.errorUrl ? safeOutboundHost(value.errorUrl) : 'not set'} · events{' '}
            {value.eventsUrl ? safeOutboundHost(value.eventsUrl) : 'not set'} ·{' '}
            {value.headers.length} header(s) (values hidden)
          </p>
          <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            HTTP 204 means accepted for asynchronous processing, <strong>not</strong> converted or
            delivered. Gotenui has no callback inbox or status history. Check your external receiver
            and use the Gotenberg-Trace ID for diagnosis. Gotenberg retries connection errors, 429
            and most 5xx replies under its own retry settings.
          </p>
        </div>
      )}
      <details className="text-xs text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-semibold">Legacy webhook JSON (optional)</summary>
        <div className="mt-2 space-y-1">
          <Label htmlFor={`${id}-webhook-json`}>Raw webhook settings — alternative to editor</Label>
          <Textarea
            id={`${id}-webhook-json`}
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={'{"url":"https://example.com/hooks/success"}'}
            value={legacy}
            onChange={(event) => onLegacyChange(event.target.value)}
          />
          <p>
            Choose the structured editor or JSON, never both. Secret values remain in memory only.
          </p>
        </div>
      </details>
    </section>
  )
}
