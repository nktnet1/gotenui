/** Centralised conditional field visibility for rendering and multipart payload construction. */
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import type { FieldDefinition, Operation } from '#/tools/types'

export function isFieldVisible(
  field: FieldDefinition,
  values: Readonly<Record<string, string | boolean>>,
): boolean {
  const condition = field.when
  if (
    field.section === 'watermark' &&
    !['nativeWatermarkText', 'nativeTiledWatermarkText'].includes(field.name)
  ) {
    return Boolean(
      String(values.nativeWatermarkText ?? '').trim() ||
        String(values.nativeTiledWatermarkText ?? '').trim(),
    )
  }
  if (!condition) return true
  const actual = values[condition.name]
  if (field.name === 'splitSpan') return actual === 'pages' || actual === 'intervals'
  if (field.name === 'ignoreResourceHttpStatusDomains') return Boolean(actual)
  // An omitted toggle has the same meaning as the upstream false default.
  return actual === condition.equals || (actual === undefined && condition.equals === false)
}

export function fieldSupportsBackend(field: FieldDefinition, version?: string): boolean {
  if (!field.supportedGotenbergMajors) return true
  const major = parseGotenbergVersion(version)?.major ?? 8
  return field.supportedGotenbergMajors.some((supported) => supported === major)
}

export function activeOperationFields(
  operation: Operation,
  values: Readonly<Record<string, string | boolean>>,
  backendVersion?: string,
): Record<string, string | boolean> {
  return Object.fromEntries(
    operation.fields
      .filter(
        (field) =>
          fieldSupportsBackend(field, backendVersion) &&
          isFieldVisible(field, values) &&
          values[field.name] !== undefined,
      )
      .map((field) => [field.name, values[field.name] as string | boolean]),
  )
}
