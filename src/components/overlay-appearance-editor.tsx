import { useEffect, useId, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  OVERLAY_APPEARANCE_FIELDS,
  OVERLAY_POSITIONS,
  type OverlayAppearanceKey,
  overlayAppearanceValue,
  overlayScaleMode,
  parseOverlayAppearance,
  updateOverlayAppearance,
  updateOverlayScaleMode,
} from '#/lib/overlay-appearance'
import type { OverlaySettings } from '#/lib/pdf-post-processing'

function AppearanceInput({
  name,
  label,
  placeholder,
  hint,
  inputMode,
  options,
  onChange,
}: {
  name: OverlayAppearanceKey
  label: string
  placeholder: string
  hint: string
  inputMode: 'decimal' | 'numeric' | 'text'
  options: string | undefined
  onChange: (next: string) => void
}) {
  const id = useId()
  const current = overlayAppearanceValue(options, name)
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft(current)
    setError('')
  }, [current])
  const commit = () => {
    try {
      onChange(updateOverlayAppearance(options, name, draft))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid appearance setting.')
    }
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setDraft(event.target.value)
          setError('')
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <p
        id={`${id}-help`}
        className={`text-xs ${error ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
      >
        {error || hint}
      </p>
    </div>
  )
}

/** Native pdfcpu appearance controls; preserve advanced and engine-specific JSON. */
export function OverlayAppearanceEditor({
  source,
  options,
  onChange,
}: {
  source: OverlaySettings['source']
  options?: string
  onChange: (next: string) => void
}) {
  const id = useId()
  const valid = parseOverlayAppearance(options) !== null
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <summary className="cursor-pointer px-3 py-3 text-xs font-semibold text-slate-700 dark:text-slate-200">
        Appearance settings
      </summary>
      <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 p-3">
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          Applies to the default pdfcpu engine. Other PDF engines may interpret these settings
          differently. Leave a field blank for its upstream default.
        </p>
        {!valid && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            Correct the custom options JSON below before using the appearance controls.
          </p>
        )}
        <fieldset disabled={!valid} className="grid gap-4 sm:grid-cols-2 disabled:opacity-50">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-position`}>Position</Label>
            <select
              id={`${id}-position`}
              value={overlayAppearanceValue(options, 'position')}
              onChange={(event) =>
                onChange(updateOverlayAppearance(options, 'position', event.target.value))
              }
              className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
            >
              <option value="">Centre (upstream default)</option>
              {OVERLAY_POSITIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-scale-mode`}>Scale mode</Label>
            <select
              id={`${id}-scale-mode`}
              value={overlayScaleMode(options)}
              onChange={(event) =>
                onChange(updateOverlayScaleMode(options, event.target.value as 'rel' | 'abs'))
              }
              className="h-10 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
            >
              <option value="rel" disabled={overlayAppearanceValue(options, 'points') !== ''}>
                Relative to page
              </option>
              <option value="abs">Absolute</option>
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Text size uses absolute scaling; setting it selects this mode automatically.
            </p>
          </div>
          {OVERLAY_APPEARANCE_FIELDS.filter(
            (field) => !('textOnly' in field) || source === 'text',
          ).map((field) => (
            <AppearanceInput
              key={field.name}
              name={field.name}
              label={field.label}
              placeholder={field.placeholder}
              hint={field.hint}
              inputMode={field.inputMode}
              options={options}
              onChange={onChange}
            />
          ))}
        </fieldset>
        <details className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
            Custom PDF-engine options JSON
          </summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor={`${id}-raw`}>Options JSON (optional)</Label>
            <Textarea
              id={`${id}-raw`}
              rows={3}
              spellCheck={false}
              className="font-mono text-xs"
              value={options ?? ''}
              placeholder={'{"opacity":0.25,"rotation":45}'}
              onChange={(event) => onChange(event.target.value)}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Extra PDF-engine keys are retained when you edit a native control.
            </p>
          </div>
        </details>
      </div>
    </details>
  )
}
