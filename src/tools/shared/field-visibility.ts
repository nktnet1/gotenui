/** Centralised conditional field visibility for rendering and multipart payload construction. */
import { type GotenbergVersion, parseGotenbergVersion } from '#/lib/gotenberg-version'
import { V8_WATERMARK_ROTATION_ERROR, v8WatermarkRotationTenths } from '#/lib/official-form-fields'
import { hasGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import { isGotenberg95PaperSize } from '#/lib/pdf-paper-sizes'
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
  if (field.name === 'ignoreResourceHttpStatusDomains') {
    return typeof actual === 'string' && actual.trim() !== '' && !/^\[\s*\]$/.test(actual.trim())
  }
  // An omitted toggle has the same meaning as the upstream false default.
  return actual === condition.equals || (actual === undefined && condition.equals === false)
}

/** Retain an ignored setting in drafts without requiring it for submission. */
export function isFieldRequired(
  field: FieldDefinition,
  values: Readonly<Record<string, string | boolean>>,
): boolean {
  return Boolean(
    field.required &&
      (!field.requiredUnless || values[field.requiredUnless.name] !== field.requiredUnless.equals),
  )
}

export function fieldSupportsBackend(field: FieldDefinition, version?: string): boolean {
  if (!field.supportedGotenbergMajors) return true
  const major = parseGotenbergVersion(version)?.major
  return (
    major !== undefined && field.supportedGotenbergMajors.some((supported) => supported === major)
  )
}

/** A minor gate belongs to a single major, even when a field is shared. */
export function fieldMinimumVersion(
  field: FieldDefinition,
): { major: 8 | 9; minor: number } | undefined {
  if (field.minGotenbergMinor === undefined) return undefined
  return {
    major:
      field.supportedGotenbergMajors?.length === 1 && field.supportedGotenbergMajors[0] === 9
        ? 9
        : 8,
    minor: field.minGotenbergMinor,
  }
}

/** Shared by the control, request builder and authenticated proxy preflight. */
export function fieldMinimumVersionReason(
  field: FieldDefinition,
  version: GotenbergVersion | null,
  value?: string | boolean,
): string | null {
  if (!version) return null
  const minimum = fieldMinimumVersion(field)
  if (
    minimum &&
    ((version.major === minimum.major && version.minor < minimum.minor) ||
      (minimum.major === 9 && version.major === 8))
  ) {
    return `${field.label} requires Gotenberg ${minimum.major}.${minimum.minor} or newer.`
  }
  if (field.name === 'pdfa' && value === 'PDF/A-4' && version.major === 8 && version.minor < 39) {
    return 'PDF/A-4 requires Gotenberg 8.39 or newer.'
  }
  if (
    field.name === 'paperSize' &&
    isGotenberg95PaperSize(value) &&
    version.major === 9 &&
    version.minor < 5
  ) {
    return 'A0, A1 and A2 paper sizes require Gotenberg 9.5 or newer.'
  }
  if (
    version.major === 9 &&
    version.minor < 2 &&
    ['pages', 'sourcePages', 'rotatePages', 'watermarkPages', 'stampPages', 'splitSpan'].includes(
      field.name,
    ) &&
    hasGotenberg92PageSyntax(value)
  ) {
    return 'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.'
  }
  if (
    version.major === 8 &&
    field.name === 'nativeWatermarkRotateAngle' &&
    value !== undefined &&
    value !== '' &&
    v8WatermarkRotationTenths(value) === null
  ) {
    return V8_WATERMARK_ROTATION_ERROR
  }
  if (version.major === 9 && value !== undefined && value !== '') {
    if (field.minGotenberg9 !== undefined && Number(value) < field.minGotenberg9) {
      return `${field.label} must be at least ${field.minGotenberg9} on Gotenberg 9.`
    }
    if (field.name === 'openBookmarkLevels') {
      const levels = Number(value)
      if (!Number.isInteger(levels) || (levels !== -1 && (levels < 1 || levels > 10))) {
        return 'Gotenberg 9 bookmark expansion must be -1 (all) or 1 to 10 levels.'
      }
    }
  }
  return null
}

export function fieldCompatibilityReason(
  field: FieldDefinition,
  backendVersion?: string,
  value?: string | boolean,
): string | null {
  const version = parseGotenbergVersion(backendVersion)
  if (!version || (version.major !== 8 && version.major !== 9)) return null
  const minimum = fieldMinimumVersionReason(field, version, value)
  if (minimum) return minimum
  if (!fieldSupportsBackend(field, backendVersion)) {
    return `${field.label} requires Gotenberg ${field.supportedGotenbergMajors?.join(' or ')}.`
  }
  return null
}

/** A blank or disabled opt-in is not a configured feature. Ignore untouched defaults. */
export function isConfiguredField(
  field: FieldDefinition,
  value: string | boolean | undefined,
): boolean {
  return value !== undefined && value !== '' && value !== (field.defaultValue ?? false)
}

export function incompatibleOperationFields(
  operation: Operation,
  values: Readonly<Record<string, string | boolean>>,
  backendVersion?: string,
  legacyStandaloneOverlay = false,
): { name: string; reason: string }[] {
  const version = parseGotenbergVersion(backendVersion)
  if (!version || (version.major !== 8 && version.major !== 9)) return []
  return operation.fields.flatMap((field) => {
    const value = values[field.name]
    if (!isFieldVisible(field, values) || !isConfiguredField(field, value)) return []
    const reason = legacyStandaloneOverlay
      ? `${field.label} belongs to the Gotenberg 9 overlay editor.`
      : fieldCompatibilityReason(field, backendVersion, value)
    return reason ? [{ name: field.name, reason }] : []
  })
}

/** Project the compatible, visible fields only after checking for conflicts. */
export function activeOperationFields(
  operation: Operation,
  values: Readonly<Record<string, string | boolean>>,
  backendVersion?: string,
): Record<string, string | boolean> {
  return Object.fromEntries(
    operation.fields
      .filter(
        (field) =>
          !fieldCompatibilityReason(field, backendVersion, values[field.name]) &&
          isFieldVisible(field, values) &&
          values[field.name] !== undefined,
      )
      .map((field) => [field.name, values[field.name] as string | boolean]),
  )
}
