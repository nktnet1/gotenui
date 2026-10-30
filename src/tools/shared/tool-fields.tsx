import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import {
  CONSOLE_MESSAGE_TYPES,
  parseConsoleMessageTypes,
  updateConsoleMessageTypes,
} from '#/lib/official-form-fields'
import { versionAtLeast } from '#/lib/operation-availability'
import type { FieldDefinition } from '#/tools/registry'

function FieldControl({
  field,
  value,
  onChange,
  disabled = false,
  backendVersion,
}: {
  field: FieldDefinition
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  disabled?: boolean
  backendVersion?: string
}) {
  const id = useId()
  const unsupported =
    field.minGotenbergMinor !== undefined &&
    versionAtLeast(backendVersion, field.minGotenbergMinor) === false
  const inactive = disabled || unsupported
  if (field.kind === 'console-message-types') {
    let selected: string[] = []
    try {
      if (typeof value === 'string' && value) selected = parseConsoleMessageTypes(value)
    } catch {
      // An invalid saved draft can still be corrected without crashing the editor.
    }
    const encoded = selected.length ? JSON.stringify(selected) : ''
    return (
      <fieldset className="col-span-full space-y-2">
        <legend className="text-sm font-medium">{field.label}</legend>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-800/40">
          {CONSOLE_MESSAGE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="checkbox"
                checked={selected.includes(type)}
                onChange={(event) =>
                  onChange(updateConsoleMessageTypes(encoded, type, event.target.checked))
                }
                disabled={disabled || (unsupported && !selected.includes(type))}
                className="size-4 accent-sky-600"
              />
              {type}
            </label>
          ))}
        </div>
        {field.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
        )}
      </fieldset>
    )
  }
  if (field.kind === 'toggle')
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 px-3.5 py-3">
        <div>
          <Label htmlFor={id} className="cursor-pointer">
            {field.label}
          </Label>
          {field.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
          )}
        </div>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled || (unsupported && value !== true)}
        />
      </div>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-red-500 dark:text-red-400">*</span>}
      </Label>
      {field.kind === 'select' ? (
        <div className="relative">
          <select
            id={id}
            className="h-11 w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 pr-9 text-sm text-slate-900 dark:text-slate-100 outline-none focus-visible:border-sky-500 focus-visible:ring-4 focus-visible:ring-sky-100 dark:focus-visible:ring-sky-900"
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
            required={field.required}
            disabled={inactive}
          >
            {!field.required && <option value="">Default / not set</option>}
            {field.options?.map((option) => (
              <option
                key={option}
                value={option}
                disabled={option === 'PDF/A-4' && versionAtLeast(backendVersion, 39) === false}
              >
                {field.optionLabels?.[option] ?? option}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-3.5 right-3 size-4 text-slate-400" />
        </div>
      ) : field.kind === 'json' ? (
        <Textarea
          id={id}
          rows={4}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={field.placeholder ?? '{ }'}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          disabled={inactive}
        />
      ) : (
        <Input
          id={id}
          type={
            field.kind === 'color'
              ? 'color'
              : field.kind === 'password'
                ? 'password'
                : field.kind === 'number'
                  ? 'number'
                  : field.kind === 'url'
                    ? 'url'
                    : 'text'
          }
          min={field.min}
          max={field.max}
          step={field.kind === 'number' ? (field.integer ? 1 : 'any') : undefined}
          autoComplete={field.kind === 'password' ? 'new-password' : undefined}
          placeholder={field.placeholder}
          value={String(value ?? (field.kind === 'color' ? '#7ffe7f' : ''))}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          disabled={inactive}
        />
      )}
      {field.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
      )}
    </div>
  )
}

export { FieldControl }
