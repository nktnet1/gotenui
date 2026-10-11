import { BookmarkPlus, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { browserStorage } from '#/lib/backend-url'
import {
  applyPresetFields,
  loadPresets,
  PRESETS_STORAGE_KEY,
  persistPresets,
  reusableFieldNames,
  upsertPreset,
} from '#/lib/conversion-presets'
import type { Operation } from '#/lib/operations'

export function ConversionPresets({
  operation,
  fields,
  onApply,
}: {
  operation: Operation
  fields: Record<string, string | boolean>
  onApply: (fields: Record<string, string | boolean>) => void
}) {
  const [saved, setSaved] = useState(() => loadPresets(browserStorage()))
  const [name, setName] = useState('')
  const [selected, setSelected] = useState('')
  const nameId = useId()
  const selectId = useId()
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PRESETS_STORAGE_KEY && event.key !== null) return
      setSaved(loadPresets(browserStorage()))
      setSelected('')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  if (!reusableFieldNames(operation).length) return null
  const available = saved.filter((preset) => preset.operationId === operation.id)
  const choice = available.find((preset) => preset.id === selected)

  function save() {
    try {
      const updated = upsertPreset(loadPresets(browserStorage()), operation, name, fields)
      if (!persistPresets(browserStorage(), updated)) {
        toast.error('Could not save the preset in this browser. Check storage permissions.')
        return
      }
      setSaved(updated)
      setSelected(
        updated.find(
          (preset) =>
            preset.name.toLowerCase() === name.trim().toLowerCase() &&
            preset.operationId === operation.id,
        )?.id ?? '',
      )
      setName('')
      toast.success('Preset saved in this browser.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save preset.')
    }
  }

  function apply() {
    if (!choice) return
    try {
      onApply(applyPresetFields(operation, fields, choice))
      toast.success('Preset settings applied. Inputs and credentials were not changed.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not apply preset.')
    }
  }

  function remove() {
    if (!choice || !window.confirm(`Delete preset "${choice.name}"?`)) return
    const updated = loadPresets(browserStorage()).filter((preset) => preset.id !== choice.id)
    if (!persistPresets(browserStorage(), updated)) {
      toast.error('Could not delete the saved preset.')
      return
    }
    setSaved(updated)
    setSelected('')
    toast.success('Preset deleted.')
  }

  return (
    <section
      aria-label="Saved operation presets"
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40"
    >
      <div className="flex items-center gap-2">
        <BookmarkPlus aria-hidden="true" className="size-4 text-sky-600 dark:text-sky-400" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Saved presets</h3>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-44 flex-1 space-y-1.5">
          <Label htmlFor={nameId}>Preset name</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={60}
            placeholder="e.g. Print-ready A4"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              }
            }}
          />
        </div>
        <Button type="button" onClick={save} disabled={!name.trim()}>
          <Save aria-hidden="true" className="size-4" /> Save preset
        </Button>
      </div>
      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-44 flex-1 space-y-1.5">
            <Label htmlFor={selectId}>Saved for this operation</Label>
            <select
              id={selectId}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-sky-900"
            >
              <option value="">Choose a preset</option>
              {available.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="secondary" disabled={!choice} onClick={apply}>
            Apply
          </Button>
          <Button
            type="button"
            variant="destructive-outline"
            disabled={!choice}
            aria-label="Delete selected preset"
            onClick={remove}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Saved only in this browser. Presets include non-sensitive layout and conversion settings,
        never URLs, documents, uploads, passwords, cookies, headers, webhook destinations, tracing,
        or Advanced JSON. Saving an existing name updates it.
      </p>
    </section>
  )
}
