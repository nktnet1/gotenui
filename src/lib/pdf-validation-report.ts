import { filenameKey, planRemoteFilenames, registeredFilenames } from '#/lib/file-names'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'
import { parsePdfConformanceProfiles } from '#/lib/pdf-conformance-profiles'
import { isV9SourceDocument } from '#/lib/source-documents'
import type { RemoteFile } from '#/lib/validation'
import { zipEntryNames } from '#/lib/zip-input-validation'

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

type ValidationInputs = {
  files: readonly File[]
  archives?: readonly File[]
  downloadFrom?: readonly RemoteFile[]
  expectedBackendVersion?: string
}

type ValidationCoverage = {
  minimumDocuments: number
  exactDocuments?: number
  filenames?: readonly string[]
}

/** Count all determinable PDFs and check exact registered names when possible.
 * Go registers remote downloads first, but iterates multipart file fields in
 * map order. With colliding uploads and archives, the count is deterministic
 * even when the exact numbered filenames are not.
 */
async function validationCoverage(inputs: ValidationInputs): Promise<ValidationCoverage> {
  const localNames = inputs.files.map(({ name }) => name)
  const archiveNames: string[] = []
  for (const archive of inputs.archives ?? []) {
    for (const name of await zipEntryNames(archive)) {
      archiveNames.push(name.split(/[/\\]/).at(-1) ?? name)
    }
  }
  const remotes = inputs.downloadFrom ?? []
  const version = parseGotenbergVersion(inputs.expectedBackendVersion)
  const remoteNames =
    version?.major === 9 && version.minor >= 2
      ? planRemoteFilenames(remotes, {
          supportsFilename: true,
          inferAll: localNames.length > 0 || Boolean(inputs.archives?.length),
          pinAll: false,
          stageAssetNames: new Set(),
        }).map(({ name }) => name)
      : remotes.map(({ filename }) => filename || undefined)
  const knownNames = [...remoteNames, ...localNames, ...archiveNames].filter(
    (name): name is string => name !== undefined,
  )
  const pdfNames = registeredFilenames(knownNames).filter((name) => isV9SourceDocument('pdf', name))
  const minimumDocuments = pdfNames.length
  // A known original name must exist in the registered workspace, even if
  // an earlier download or a numbered duplicate occupies that name first.
  // Only the additional numbered names depend on registration order.
  const requiredNames = [...new Set(knownNames.map(filenameKey))].filter((name) =>
    isV9SourceDocument('pdf', name),
  )
  if (remoteNames.some((name) => name === undefined))
    return { minimumDocuments, filenames: requiredNames }
  const ambiguousRegistration =
    localNames.length > 0 &&
    archiveNames.length > 0 &&
    new Set(knownNames.map(filenameKey)).size !== knownNames.length
  return {
    minimumDocuments,
    exactDocuments: minimumDocuments,
    filenames: ambiguousRegistration ? requiredNames : pdfNames,
  }
}

export function parsePdfValidationReport(
  raw: string,
  expectedProfiles?: readonly string[],
  coverage?: ValidationCoverage,
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
  if (
    !entries.length ||
    entries.length > MAX_PDF_VALIDATION_DOCUMENTS ||
    (coverage && entries.length < coverage.minimumDocuments) ||
    (coverage?.exactDocuments !== undefined && entries.length !== coverage.exactDocuments) ||
    coverage?.filenames?.some((filename) => !Object.hasOwn(document, filename))
  )
    return null
  const reports: PdfValidationResult[] = []
  for (const [filename, report] of entries) {
    if (
      !isV9SourceDocument('pdf', filename) ||
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
  inputs?: ValidationInputs,
): Promise<PdfValidationResult[] | null> {
  if (blob.size > MAX_PDF_VALIDATION_SUMMARY_BYTES) return null
  try {
    return parsePdfValidationReport(
      new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()),
      expectedProfiles,
      inputs ? await validationCoverage(inputs) : undefined,
    )
  } catch {
    return null
  }
}
