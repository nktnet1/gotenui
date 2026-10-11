import * as v from 'valibot'
import { OPERATION_BY_ID, type Operation, operationDefaults } from '#/lib/operations'

/** Only public, non-sensitive, repeatable operation settings may enter localStorage. */
export const PRESETS_STORAGE_KEY = 'gotenui.presets.v1'
export const MAX_PRESETS = 25

export type ConversionPreset = {
  id: string
  operationId: string
  name: string
  fields: Record<string, string | boolean>
}

const presetSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^preset-[a-f\d-]{36}$/i)),
  operationId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(60)),
  fields: v.record(v.string(), v.union([v.string(), v.boolean()])),
})
const savedSchema = v.strictObject({
  version: v.literal(1),
  presets: v.pipe(v.array(presetSchema), v.maxLength(MAX_PRESETS)),
})

const SAFE_TEXT_FIELDS: Readonly<Record<string, RegExp>> = {
  paperWidth: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  paperHeight: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  marginTop: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  marginBottom: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  marginLeft: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  marginRight: /^\d+(?:\.\d+)?(?:in|cm|mm|px|pt)?$/,
  nativePageRanges: /^\d[\d,\- ]{0,99}$/,
  rotatePages: /^\d[\d,\- ]{0,99}$/,
  splitSpan: /^\d[\d,\- ]{0,99}$/,
  waitDelay: /^\d+(?:\.\d+)?(?:ms|s|m)$/,
}

/** Deliberately exclude URL, password, JSON and free text fields from persisted presets. */
export function reusableFieldNames(operation: Operation): string[] {
  return operation.fields
    .filter(
      (field) =>
        field.kind === 'toggle' ||
        field.kind === 'select' ||
        field.kind === 'number' ||
        (field.kind === 'text' && Object.hasOwn(SAFE_TEXT_FIELDS, field.name)),
    )
    .map((field) => field.name)
}

/** Pick fields from the trusted operation catalogue, never arbitrary request JSON keys. */
export function capturePresetFields(
  operation: Operation,
  current: Record<string, string | boolean>,
): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = {}
  const permitted = new Set(reusableFieldNames(operation))
  for (const definition of operation.fields) {
    if (!permitted.has(definition.name)) continue
    const value = current[definition.name]
    if (value === undefined || value === '') continue
    if (definition.kind === 'toggle') {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${definition.label} preset value.`)
      fields[definition.name] = value
      continue
    }
    if (typeof value !== 'string') throw new Error(`Invalid ${definition.label} preset value.`)
    if (value.length > 100) throw new Error(`Invalid ${definition.label} preset value.`)
    if (definition.kind === 'select') {
      if (!definition.options?.includes(value))
        throw new Error(`Invalid ${definition.label} preset value.`)
    } else if (definition.kind === 'number') {
      if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ||
        !Number.isFinite(Number(value)) ||
        (definition.min !== undefined && Number(value) < definition.min) ||
        (definition.max !== undefined && Number(value) > definition.max) ||
        (definition.integer === true && !Number.isInteger(Number(value)))
      ) {
        throw new Error(`Invalid ${definition.label} preset value.`)
      }
    } else if (definition.kind === 'text' && !SAFE_TEXT_FIELDS[definition.name]?.test(value)) {
      throw new Error(`Invalid ${definition.label} preset value.`)
    }
    fields[definition.name] = value
  }
  return fields
}

function validatedPresets(value: unknown): ConversionPreset[] | null {
  const result = v.safeParse(savedSchema, value)
  if (!result.success) return null
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const preset of result.output.presets) {
    const operation = OPERATION_BY_ID.get(preset.operationId)
    if (!operation || preset.name !== preset.name.trim() || !reusableFieldNames(operation).length)
      return null
    if (ids.has(preset.id)) return null
    ids.add(preset.id)
    const key = `${preset.operationId}:${preset.name.toLocaleLowerCase()}`
    if (names.has(key)) return null
    names.add(key)
    // Stored data is untrusted, so reject unknown, sensitive or invalid fields instead of stripping.
    try {
      const filtered = capturePresetFields(operation, preset.fields)
      if (
        Object.keys(filtered).length !== Object.keys(preset.fields).length ||
        Object.entries(filtered).some(([field, fieldValue]) => preset.fields[field] !== fieldValue)
      ) {
        return null
      }
    } catch {
      return null
    }
  }
  return result.output.presets
}

export function loadPresets(storage: Pick<Storage, 'getItem'> | null): ConversionPreset[] {
  try {
    const raw = storage?.getItem(PRESETS_STORAGE_KEY)
    if (!raw || raw.length > 64_000) return []
    return validatedPresets(JSON.parse(raw)) ?? []
  } catch {
    return []
  }
}

export function persistPresets(
  storage: Pick<Storage, 'setItem'> | null,
  presets: readonly ConversionPreset[],
): boolean {
  try {
    if (!storage) return false
    const payload = { version: 1, presets }
    const safe = validatedPresets(payload)
    if (!safe) return false
    const raw = JSON.stringify({ version: 1, presets: safe })
    if (raw.length > 64_000) return false
    storage.setItem(PRESETS_STORAGE_KEY, raw)
    return true
  } catch {
    return false
  }
}

export function upsertPreset(
  presets: readonly ConversionPreset[],
  operation: Operation,
  name: string,
  current: Record<string, string | boolean>,
  newId = `preset-${crypto.randomUUID()}`,
): ConversionPreset[] {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed.length > 60 ||
    [...trimmed].some((char) => {
      const code = char.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    throw new Error('Enter a preset name of up to 60 characters.')
  }
  if (!reusableFieldNames(operation).length) {
    throw new Error('This operation has no reusable settings.')
  }
  const fields = capturePresetFields(operation, current)
  const previous = presets.find(
    (preset) =>
      preset.operationId === operation.id &&
      preset.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  )
  if (!previous && presets.length >= MAX_PRESETS) {
    throw new Error(`You can save up to ${MAX_PRESETS} presets. Delete one before adding another.`)
  }
  const updated = {
    id: previous?.id ?? newId,
    operationId: operation.id,
    name: trimmed,
    fields,
  }
  return previous
    ? presets.map((preset) => (preset.id === previous.id ? updated : preset))
    : [...presets, updated]
}

/** Loading a preset only replaces eligible controls. Private input state stays in memory. */
export function applyPresetFields(
  operation: Operation,
  current: Record<string, string | boolean>,
  preset: ConversionPreset,
): Record<string, string | boolean> {
  if (preset.operationId !== operation.id) throw new Error('Preset belongs to another operation.')
  const permitted = reusableFieldNames(operation)
  const valid = capturePresetFields(operation, preset.fields)
  if (Object.keys(valid).length !== Object.keys(preset.fields).length) {
    throw new Error('Preset contains unsupported settings.')
  }
  const next = { ...current }
  for (const field of permitted) delete next[field]
  return { ...next, ...capturePresetFields(operation, operationDefaults(operation)), ...valid }
}
