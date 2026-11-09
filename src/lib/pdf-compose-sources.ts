import type { PdfPipelineStage } from '#/lib/pdf-pipeline'
import { InputError } from '#/lib/validation'

/** A PDF source name as entered in the editor and as sent to Gotenberg. */
export type PdfComposeInput = { original: string; forwarded: string }

type SourceTemplate = PdfComposeInput

const partMarker = '\u0001'

function numberPart(name: string): { number: bigint; rest: string; prefix: boolean } | null {
  const prefix = /^(\d+)(.*)$/.exec(name)
  const suffix = prefix ? null : /^(.*?)(\d+)(\.[^.]+)$/.exec(name)
  const trailing = prefix || suffix ? null : /^(.*?)(\d+)$/.exec(name)
  const number = prefix?.[1] ?? suffix?.[2] ?? trailing?.[2]
  if (number === undefined) return null
  const numeric = BigInt(number)
  // Go's strconv.Atoi uses a signed 64-bit int on Gotenberg's platforms.
  if (numeric > 9_223_372_036_854_775_807n) return null
  return {
    number: numeric,
    rest: prefix ? prefix[2] : suffix ? suffix[1] + suffix[3] : (trailing?.[1] ?? ''),
    prefix: Boolean(prefix),
  }
}

/** Mirrors gotenberg.AlphanumericSort, which determines the first merged filename. */
function compareSourceNames(left: string, right: string): number {
  const a = numberPart(left)
  const b = numberPart(right)
  if (a && b) {
    if (a.prefix && b.prefix) {
      if (a.number !== b.number) return a.number < b.number ? -1 : 1
      return a.rest < b.rest ? -1 : a.rest > b.rest ? 1 : 0
    }
    if (!a.prefix && !b.prefix) {
      if (a.rest !== b.rest) return a.rest < b.rest ? -1 : 1
      if (a.number !== b.number) return a.number < b.number ? -1 : 1
      // Gotenberg breaks equal suffix numbers by the original filename.
      return left < right ? -1 : left > right ? 1 : 0
    } else {
      if (a.rest !== b.rest) return a.rest < b.rest ? -1 : 1
      return a.prefix ? -1 : 1
    }
  } else if (a || b) {
    return a ? -1 : 1
  }
  return left < right ? -1 : left > right ? 1 : 0
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
  }: { inputs: readonly PdfComposeInput[]; unknownInputs?: boolean; singleInput?: boolean },
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

  return stages.map((stage) => {
    if (stage.op === 'merge') {
      sources = firstSource(sources)
      single = true
      afterSplit = false
      return stage
    }
    if (stage.op === 'split') {
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
        if (afterSplit) {
          throw new InputError(
            'compose: cannot resolve filenames after split when source filenames are unknown or collide. Set a Chromium output filename, downloadFrom filename overrides for remotes, or use separately named PDF inputs.',
          )
        }
        return entry
      }
      const matches = sources.flatMap(({ original, forwarded }) => {
        const parts = matchTemplate(name, original) ?? matchTemplate(name, forwarded)
        return parts ? [materialize(forwarded, parts)] : []
      })
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
    sources = firstSource(sources)
    single = true
    afterSplit = false
    return { ...stage, placements }
  })
}
