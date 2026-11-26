/** Gotenberg 9 profileSet and pairedPdfua (pkg/modules/pdf/stage_types.go). */
export const PDF_CONFORMANCE_PROFILES = [
  'PDF/A-1a',
  'PDF/A-1b',
  'PDF/A-2a',
  'PDF/A-2b',
  'PDF/A-2u',
  'PDF/A-3a',
  'PDF/A-3b',
  'PDF/A-3u',
  'PDF/A-4',
  'PDF/A-4e',
  'PDF/A-4f',
  'PDF/UA-1',
  'PDF/UA-2',
  'Factur-X',
] as const

const profiles = new Set<string>(PDF_CONFORMANCE_PROFILES)

export function isPdfConformanceProfile(value: unknown): value is string {
  return typeof value === 'string' && profiles.has(value)
}

export function pairedPdfuaProfile(profile: string): string | undefined {
  if (!isPdfConformanceProfile(profile) || profile.startsWith('PDF/UA-')) return undefined
  return profile.startsWith('PDF/A-4') ? 'PDF/UA-2' : 'PDF/UA-1'
}

export function parsePdfConformanceProfiles(value: unknown): string[] | null {
  const values = Array.isArray(value) ? value : [value]
  if (!values.length || values.length > 2 || !values.every(isPdfConformanceProfile)) return null
  if (values.length === 1) return values
  const [first, second] = values as [string, string]
  return pairedPdfuaProfile(first) === second || pairedPdfuaProfile(second) === first
    ? values
    : null
}

/** Use the same normalization as the standalone validation multipart adapter. */
export function requestedPdfValidationProfiles(
  fields: Readonly<Record<string, string | boolean>>,
): string[] {
  const main = typeof fields.profile === 'string' ? fields.profile.trim() : ''
  const additional =
    typeof fields.additionalProfile === 'string' ? fields.additionalProfile.trim() : ''
  return additional ? [main, additional] : [main]
}

export function pdfValidationProfileIssue(
  fields: Readonly<Record<string, string | boolean>>,
): string | undefined {
  const [main, additional] = requestedPdfValidationProfiles(fields)
  if (!isPdfConformanceProfile(main)) return 'Choose a supported validation profile.'
  if (additional) {
    const paired = pairedPdfuaProfile(main)
    if (!paired) return 'The additional PDF/UA profile requires a PDF/A or Factur-X main profile.'
    if (paired !== additional)
      return `The additional PDF/UA profile must match the PDF/A version (${paired}).`
  }
  return undefined
}
