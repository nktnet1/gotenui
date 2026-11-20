import { type FileBookmarks, mapFileBookmarkLabels } from '#/lib/pdf-file-bookmarks'
import type { PdfPipelineStage } from '#/lib/pdf-pipeline'
import { InputError } from '#/lib/validation'

/** A PDF source name as entered in the editor and as sent to Gotenberg. */
export type PdfComposeInput = { original: string; forwarded: string }

type SourceTemplate = PdfComposeInput

const partMarker = '\u0001'

const maxGoInt = '9223372036854775807'

/** strconv.Atoi accepts leading zeros but refuses values outside signed int64. */
function goInteger(value: string): bigint | null {
  const digits = value.replace(/^0+(?=\d)/, '')
  if (digits.length > maxGoInt.length || (digits.length === maxGoInt.length && digits > maxGoInt)) {
    return null
  }
  return BigInt(digits)
}

function numberPart(name: string): { number: bigint; rest: string; prefix: boolean } | null {
  const prefix = /^(\d+)(.*)$/.exec(name)
  if (prefix) {
    const number = goInteger(prefix[1] as string)
    if (number !== null) return { number, rest: prefix[2] as string, prefix: true }
  }
  const suffix = /^(.*?)(\d+)(\.[^.]+)$/.exec(name)
  if (suffix) {
    const number = goInteger(suffix[2] as string)
    if (number !== null) {
      return { number, rest: `${suffix[1]}${suffix[3]}`, prefix: false }
    }
  }
  const trailing = /^(.*?)(\d+)$/.exec(name)
  if (trailing) {
    const number = goInteger(trailing[2] as string)
    if (number !== null) return { number, rest: trailing[1] as string, prefix: false }
  }
  return null
}

/** Go compares UTF-8 bytes lexicographically, which follows Unicode codepoint order. */
function compareGoStrings(left: string, right: string): number {
  const a = left[Symbol.iterator]()
  const b = right[Symbol.iterator]()
  while (true) {
    const x = a.next()
    const y = b.next()
    if (x.done) return y.done ? 0 : -1
    if (y.done) return 1
    const l = x.value.codePointAt(0) as number
    const r = y.value.codePointAt(0) as number
    if (l !== r) return l < r ? -1 : 1
  }
}

/** Mirrors gotenberg.AlphanumericSort, which determines the first merged filename. */
function compareSourceNames(left: string, right: string): number {
  const a = numberPart(left)
  const b = numberPart(right)
  if (a && b) {
    if (a.prefix && b.prefix) {
      if (a.number !== b.number) return a.number < b.number ? -1 : 1
      return compareGoStrings(a.rest, b.rest)
    }
    if (!a.prefix && !b.prefix) {
      const compared = compareGoStrings(a.rest, b.rest)
      if (compared !== 0) return compared
      if (a.number !== b.number) return a.number < b.number ? -1 : 1
      // Gotenberg breaks equal suffix numbers by the original filename.
      return compareGoStrings(left, right)
    }
    const compared = compareGoStrings(a.rest, b.rest)
    return compared !== 0 ? compared : a.prefix ? -1 : 1
  }
  if (a || b) return a ? -1 : 1
  return compareGoStrings(left, right)
}

function splitName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}_${partMarker}.pdf`
}

function matchTemplate(name: string, template: string): string[] | null {
  const escaped = template
    .split(partMarker)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(\\d+)')
  const matched = new RegExp(`^${escaped}$`).exec(name)
  return matched ? matched.slice(1) : null
}

function materialize(template: string, parts: readonly string[]): string {
  let index = 0
  return template.replaceAll(partMarker, () => parts[index++] ?? '')
}

/** Current Gotenberg filenames take precedence over convenient original-name
 * aliases when a numbered upload has the same spelling as another input.
 */
function currentFileMatches(name: string, sources: readonly SourceTemplate[]): string[] {
  const forwarded = sources.flatMap(({ forwarded }) => {
    const parts = matchTemplate(name, forwarded)
    return parts ? [materialize(forwarded, parts)] : []
  })
  if (forwarded.length) return forwarded
  return sources.flatMap(({ original, forwarded }) => {
    const parts = matchTemplate(name, original)
    return parts ? [materialize(forwarded, parts)] : []
  })
}

function firstSource(sources: readonly SourceTemplate[] | null): SourceTemplate[] | null {
  if (!sources?.length) return null
  const first = sources[0]
  if (!first) return null
  // A split returns parts in document order; the first part of the first
  // document is the one Gotenberg names a subsequent merge/compose after.
  const zeros = first.original
    .split(partMarker)
    .slice(1)
    .map(() => '0')
  return [
    {
      original: materialize(first.original, zeros),
      forwarded: materialize(first.forwarded, zeros),
    },
  ]
}

/** Resolve bookmark labels against the PDFs that exist at this merge stage.
 * Split outputs are not known until Gotenberg counts their pages, but an
 * explicit label such as report_0.pdf can still follow a numbered upload.
 */
function mapCurrentBookmarkLabels(
  bookmarks: FileBookmarks,
  sources: readonly SourceTemplate[],
): FileBookmarks {
  const staticSources = sources.filter(
    ({ original, forwarded }) => !original.includes(partMarker) && !forwarded.includes(partMarker),
  )
  const dynamicSources = sources.filter(
    ({ original, forwarded }) => original.includes(partMarker) || forwarded.includes(partMarker),
  )
  if (!dynamicSources.length) {
    // Even unchanged filenames need NFC-normalized label keys. Gotenberg
    // normalizes uploads but does not normalize keys in the JSON options.
    return bookmarks.labels || sources.some(({ original, forwarded }) => original !== forwarded)
      ? mapFileBookmarkLabels(bookmarks, sources, { preferForwarded: true })
      : bookmarks
  }

  const labels: Record<string, string> = Object.create(null)
  for (const [name, label] of Object.entries(bookmarks.labels ?? {})) {
    const normalized = name.normalize('NFC')
    const matches = currentFileMatches(normalized, dynamicSources)
    for (const target of matches.length ? matches : [normalized]) {
      if (Object.hasOwn(labels, target)) {
        throw new InputError(`merge: duplicate fileBookmarks label for ${target}.`)
      }
      labels[target] = label
    }
  }
  // A split may produce any number of parts. Do not invent labels for parts
  // that have not yet been created, or send the internal template marker.
  if (!staticSources.length) {
    return bookmarks.labels ? { ...bookmarks, labels } : bookmarks
  }
  return mapFileBookmarkLabels(
    bookmarks.labels ? { ...bookmarks, labels } : bookmarks,
    staticSources,
    { preferForwarded: true },
  )
}

/** Reconcile compose references against Gotenberg 9.2's document-name rules.
 * Merge/compose always leave one PDF (so source is optional); split appends a
 * zero-based suffix to the *current* filename, not a generic document name.
 * Never fabricate names when an unnamed remote or duplicate input intervenes.
 */
export function reconcilePdfComposeSources(
  stages: readonly PdfPipelineStage[],
  {
    inputs,
    unknownInputs = false,
    singleInput = false,
    mapBookmarks = false,
  }: {
    inputs: readonly PdfComposeInput[]
    unknownInputs?: boolean
    singleInput?: boolean
    mapBookmarks?: boolean
  },
): PdfPipelineStage[] {
  const names = inputs.map(({ original, forwarded }) => ({
    original: original.normalize('NFC'),
    forwarded: forwarded.normalize('NFC'),
  }))
  const duplicateInputs = new Set(names.map(({ forwarded }) => forwarded)).size !== names.length
  let sources: SourceTemplate[] | null =
    unknownInputs || duplicateInputs
      ? null
      : names.sort((a, b) => compareSourceNames(a.forwarded, b.forwarded))
  let single = singleInput || (!unknownInputs && names.length === 1)
  let afterSplit = false
  // Unknown remote names prevent predicting a later merge output, but they
  // do not change the known local filenames before the first reshaping stage.
  let initialNamesPreserved = true

  return stages.map((stage) => {
    if (stage.op === 'merge') {
      const candidates = sources ?? (initialNamesPreserved ? names : null)
      const mapped =
        mapBookmarks && candidates?.length && stage.fileBookmarks
          ? {
              ...stage,
              fileBookmarks: mapCurrentBookmarkLabels(
                stage.fileBookmarks as FileBookmarks,
                candidates,
              ),
            }
          : stage
      initialNamesPreserved = false
      sources = firstSource(sources)
      single = true
      afterSplit = false
      return mapped
    }
    if (stage.op === 'split') {
      initialNamesPreserved = false
      sources =
        sources?.map(({ original, forwarded }) => ({
          original: splitName(original),
          forwarded: splitName(forwarded),
        })) ?? null
      single = single && Array.isArray(stage.ranges) && stage.ranges.length === 1
      afterSplit = true
      return stage
    }
    if (stage.op !== 'compose' || !Array.isArray(stage.placements)) return stage

    const placements = stage.placements.map((placement: unknown, index) => {
      if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
        return placement // parsePdfPipeline validates placement objects first.
      }
      const entry = placement as Record<string, unknown>
      const name = typeof entry.source === 'string' ? entry.source.normalize('NFC') : ''
      if (single) {
        // There is exactly one current PDF. Omitting source is the backend's
        // supported way to refer to it regardless of dynamic merged filenames.
        const rest = { ...entry }
        delete rest.source
        return rest
      }
      if (!name) {
        throw new InputError(
          afterSplit
            ? `compose: placement ${index + 1} needs a source after split (for example, report_0.pdf).`
            : `compose: placement ${index + 1} needs a source when more than one PDF is present.`,
        )
      }
      if (!sources?.length) {
        // Gotenberg auto-numbers colliding uploads (including ZIP entries), so
        // the current name may be "report (2)_0.pdf" after a split. The preflight
        // cannot predict which upload gets the suffix when fields collide.
        // Forward an explicitly supplied current name for Gotenberg to check,
        // rather than rejecting a valid reference to a numbered source.
        if (afterSplit && !(duplicateInputs && !unknownInputs)) {
          throw new InputError(
            'compose: cannot resolve filenames after split when source filenames are unknown. Set a Chromium output filename, downloadFrom filename overrides for remotes, or use separately named PDF inputs.',
          )
        }
        return entry
      }
      const matches = currentFileMatches(name, sources)
      if (matches.length !== 1) {
        const example = materialize(sources[0]?.forwarded ?? 'report_0.pdf', ['0'])
        throw new InputError(
          afterSplit
            ? `compose: source "${name}" does not match a split output. Use its current filename (for example, "${example}").`
            : `compose: source "${name}" is not one of the current PDF inputs.`,
        )
      }
      return { ...entry, source: matches[0] }
    })
    initialNamesPreserved = false
    sources = firstSource(sources)
    single = true
    afterSplit = false
    return { ...stage, placements }
  })
}
