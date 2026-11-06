/** Gotenberg 9 /forms/pdf/validate returns a filename-keyed compliance report. */
export type PdfValidationResult = {
  filename: string
  compliant: boolean
  profile: string
  violations: { id: string; description: string; severity: string }[]
  totalViolations: number
}

export function parsePdfValidationReport(raw: string): PdfValidationResult[] | null {
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return null
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null
  const reports: PdfValidationResult[] = []
  for (const [filename, report] of Object.entries(document)) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) return null
    const row = report as Record<string, unknown>
    if (typeof row.compliant !== 'boolean' || !Array.isArray(row.violations)) return null
    const profiles = Array.isArray(row.profile) ? row.profile : [row.profile]
    if (!profiles.length || !profiles.every((profile) => typeof profile === 'string')) return null
    const violations = row.violations
    if (
      !violations.every(
        (violation) =>
          violation &&
          typeof violation === 'object' &&
          !Array.isArray(violation) &&
          typeof violation.description === 'string',
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
  return reports.length ? reports : null
}
