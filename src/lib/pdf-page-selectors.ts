/** Gotenberg 9 page selections use litho ranges, odd/even and last.
 * From 9.2 onward a term may exclude pages with !, and ranges may be open-ended.
 * `all` remains valid only by itself. Resolving ranges (including empty selections)
 * against the document's page count belongs upstream.
 */
const term = String.raw`!?((?:[1-9]\d*(?:-(?:[1-9]\d*)?)?|-[1-9]\d*)|odd|even|last)`
const range = new RegExp(`^${term}(?:\\s*,\\s*${term})*$`, 'i')

export function isPdfPageSelector(value: unknown): value is string {
  return (
    typeof value === 'string' && (value.trim().toLowerCase() === 'all' || range.test(value.trim()))
  )
}

/** A 9.0/9.1 server cannot resolve 9.2 exclusions or open-ended ranges. */
export function hasGotenberg92PageSyntax(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.split(',').some((part) => {
    const token = part.trim()
    return token.startsWith('!') || /^-\d+$/.test(token) || /^\d+-$/.test(token)
  })
}

export function stagesUseGotenberg92PageSyntax(
  stages: readonly Record<string, unknown>[],
): boolean {
  return stages.some(
    (stage) =>
      hasGotenberg92PageSyntax(stage.pages) ||
      hasGotenberg92PageSyntax(stage.sourcePages) ||
      (Array.isArray(stage.ranges) && stage.ranges.some(hasGotenberg92PageSyntax)),
  )
}
