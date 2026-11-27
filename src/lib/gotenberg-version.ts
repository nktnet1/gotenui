/** API compatibility is based on the selected server's /version response, not the UI version. */
import { stagesUseGotenberg92PageSyntax } from '#/lib/pdf-page-selectors'
import { isGotenberg95PaperSize } from '#/lib/pdf-paper-sizes'
export const MAX_GOTENBERG_VERSION_LENGTH = 80

export type SupportedGotenbergMajor = 8 | 9

export type GotenbergVersion = {
  major: number
  minor: number
  patch: number
}

/** Accept release and prerelease versions; do not guess a major from arbitrary text. */
export function parseGotenbergVersion(version: string | undefined): GotenbergVersion | null {
  if (!version || version.length > MAX_GOTENBERG_VERSION_LENGTH) return null
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version,
  )
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? 0)
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch }
}

/** A validated pinned version can also inform local preflight. */
export function supportedGotenbergMajor(
  version: string | undefined,
): SupportedGotenbergMajor | undefined {
  const major = parseGotenbergVersion(version)?.major
  return major === 8 || major === 9 ? major : undefined
}

/** Minor releases introduce API features. Patch releases use the same adapter contract. */
export function sameGotenbergApiVersion(a: GotenbergVersion, b: GotenbergVersion): boolean {
  return a.major === b.major && a.minor === b.minor
}

/** PDF extraction endpoints and final pipeline stages were added in Gotenberg 9.1. */
export function requiresGotenberg91ForExtraction(
  version: GotenbergVersion,
  operations: Iterable<string>,
): boolean {
  if (version.major !== 9 || version.minor >= 1) return false
  for (const operation of operations) {
    if (operation === 'extract-text' || operation === 'extract-attachments') return true
  }
  return false
}

/** PDF composition is new in Gotenberg 9.2 (both the route and pipeline stage). */
export function requiresGotenberg92ForComposition(
  version: GotenbergVersion,
  operations: Iterable<string>,
): boolean {
  if (version.major !== 9 || version.minor >= 2) return false
  for (const operation of operations) {
    if (operation === 'compose' || operation === 'compose-pages') return true
  }
  return false
}

/** Only Gotenberg 9.4+ understands the position option, even if its value is empty.
 * Older stage decoders reject unknown option names before decoding their values.
 */
export function requiresGotenberg94ForStampPosition(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; position?: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 4) return false
  for (const stage of stages) {
    const { op } = stage
    if (
      (op === 'stamp-text' || op === 'stamp-image' || op === 'stamp-pdf') &&
      Object.hasOwn(stage, 'position')
    ) {
      return true
    }
  }
  return false
}

/** Large named paper sizes were added in 9.5 for Chromium, Office and PDF compose. */
export function requiresGotenberg95ForPaperSize(
  version: GotenbergVersion,
  sizes: Iterable<unknown>,
): boolean {
  if (version.major !== 9 || version.minor >= 5) return false
  for (const size of sizes) {
    if (isGotenberg95PaperSize(size)) return true
  }
  return false
}

/** `dropSignatures` exists only on rewriting PDF stages as of Gotenberg 9.6. */
export function requiresGotenberg96ForSignatureDrop(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; [key: string]: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 6) return false
  for (const stage of stages) {
    if (Object.hasOwn(stage, 'dropSignatures')) return true
  }
  return false
}

/** `fileBookmarks` is a merge-stage option added in Gotenberg 9.7. */
export function requiresGotenberg97ForFileBookmarks(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; fileBookmarks?: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 7) return false
  for (const stage of stages) {
    if (stage.op === 'merge' && Object.hasOwn(stage, 'fileBookmarks')) {
      return true
    }
  }
  return false
}

/** 9.8 adds a `format` option to extract-text (including explicit "text"). */
export function requiresGotenberg98ForExtractTextFormat(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; format?: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 8) return false
  for (const stage of stages) {
    if (stage.op === 'extract-text' && Object.hasOwn(stage, 'format')) return true
  }
  return false
}

/** 9.9 adds an optional `compressStreams` switch to optimize stages. */
export function requiresGotenberg99ForCompressStreams(
  version: GotenbergVersion,
  stages: Iterable<{ op: string; compressStreams?: unknown }>,
): boolean {
  if (version.major !== 9 || version.minor >= 9) return false
  for (const stage of stages) {
    if (stage.op === 'optimize' && Object.hasOwn(stage, 'compressStreams')) return true
  }
  return false
}

/** A single stage-version contract for the editor, browser transport and proxy. */
export function pipelineMinimumVersionReason(
  version: GotenbergVersion,
  stages: readonly { op: string; [key: string]: unknown }[],
): string | null {
  if (
    requiresGotenberg91ForExtraction(
      version,
      stages.map(({ op }) => op),
    )
  )
    return 'PDF text and attachment extraction require Gotenberg 9.1 or newer.'
  if (
    requiresGotenberg92ForComposition(
      version,
      stages.map(({ op }) => op),
    )
  )
    return 'PDF page composition requires Gotenberg 9.2 or newer.'
  if (requiresGotenberg94ForStampPosition(version, stages))
    return 'Anchored PDF stamps require Gotenberg 9.4 or newer.'
  if (
    requiresGotenberg95ForPaperSize(
      version,
      stages.filter(({ op }) => op === 'compose').map(({ paperSize }) => paperSize),
    )
  )
    return 'A0, A1 and A2 paper sizes require Gotenberg 9.5 or newer.'
  if (requiresGotenberg96ForSignatureDrop(version, stages))
    return 'Removing digital signatures requires Gotenberg 9.6 or newer.'
  if (requiresGotenberg97ForFileBookmarks(version, stages))
    return 'Per-file merge bookmarks require Gotenberg 9.7 or newer.'
  if (requiresGotenberg98ForExtractTextFormat(version, stages))
    return 'Extraction formats require Gotenberg 9.8 or newer.'
  if (requiresGotenberg99ForCompressStreams(version, stages))
    return 'PDF stream compression control requires Gotenberg 9.9 or newer.'
  if (version.major === 9 && version.minor < 2 && stagesUseGotenberg92PageSyntax(stages))
    return 'Page exclusions and open-ended ranges require Gotenberg 9.2 or newer.'
  return null
}
