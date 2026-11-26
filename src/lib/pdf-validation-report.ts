import { parsePdfConformanceProfiles } from '#/lib/pdf-conformance-profiles'

/** Gotenberg 9 /forms/pdf/validate returns a filename-keyed compliance report. */
export type PdfValidationResult = {
  filename: string
  compliant: boolean
  profile: string
  violations: { id: string; description: string; severity: string }[]
  totalViolations: number
}

/** Both direct and queued summaries have a bounded cost; the JSON download is
 * always retained when a report is too large or malformed to summarise.
 */
export const MAX_PDF_VALIDATION_SUMMARY_BYTES = 128_000
const MAX_PDF_VALIDATION_DOCUMENTS = 200

export function parsePdfValidationReport(
  raw: string,
  expectedProfiles?: readonly string[],
): PdfValidationResult[] | null {
  if (raw.length > MAX_PDF_VALIDATION_SUMMARY_BYTES) return null
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return null
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null
  const entries = Object.entries(document)
  if (!entries.length || entries.length > MAX_PDF_VALIDATION_DOCUMENTS) return null
  const reports: PdfValidationResult[] = []
  for (const [filename, report] of entries) {
    if (
      !filename.trim() ||
      filename.length > 255 ||
      !report ||
      typeof report !== 'object' ||
      Array.isArray(report)
    )
      return null
    const row = report as Record<string, unknown>
    if (typeof row.compliant !== 'boolean' || !Array.isArray(row.violations)) return null
    const profiles = parsePdfConformanceProfiles(row.profile)
    if (
      !profiles ||
      (expectedProfiles &&
        (profiles.length !== expectedProfiles.length ||
          !profiles.every((profile) => expectedProfiles.includes(profile))))
    )
      return null
    const violations = row.violations
    if (
      // Gotenberg 9.3 bases compliance on fatal findings only. Factur-X can
      // be compliant while reporting non-fatal Schematron warnings.
      (row.compliant &&
        violations.some(
          (violation) =>
            violation &&
            typeof violation === 'object' &&
            !Array.isArray(violation) &&
            typeof violation.severity === 'string' &&
            violation.severity.toLowerCase() === 'fatal',
        )) ||
      !violations.every(
        (violation) =>
          violation &&
          typeof violation === 'object' &&
          !Array.isArray(violation) &&
          typeof violation.description === 'string' &&
          !!violation.description.trim() &&
          (violation.severity === undefined || typeof violation.severity === 'string'),
      )
    )
      return null
    reports.push({
      filename,
      compliant: row.compliant,
      profile: profiles.join(' + '),
      totalViolations: violations.length,
      violations: violations.slice(0, 5).map((violation, index) => ({
        id: `${filename}-${index}`,
        description: String(violation.description).slice(0, 500),
        severity: typeof violation.severity === 'string' ? violation.severity.slice(0, 100) : '',
      })),
    })
  }
  return reports
}

/** Do not decode an arbitrarily large or malformed upstream JSON response. */
export async function summarisePdfValidationBlob(
  blob: Blob,
  expectedProfiles?: readonly string[],
): Promise<PdfValidationResult[] | null> {
  if (blob.size > MAX_PDF_VALIDATION_SUMMARY_BYTES) return null
  try {
    return parsePdfValidationReport(
      new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()),
      expectedProfiles,
    )
  } catch {
    return null
  }
}
