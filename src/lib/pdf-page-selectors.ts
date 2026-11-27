import { parseGoFormInteger } from '#/lib/number-field-values'
import { trimGoWhitespace } from '#/lib/unicode-text'

/** Match litho's page grammar and Go integer/whitespace semantics. Actual
 * page counts and selections that resolve to no pages belong upstream.
 */
function positivePage(value: string): bigint | undefined {
  const page = parseGoFormInteger(value)
  return page !== undefined && page > 0n ? page : undefined
}

function validTerm(raw: string): boolean {
  let term = trimGoWhitespace(raw)
  if (term.startsWith('!')) term = trimGoWhitespace(term.slice(1))
  if (['odd', 'even', 'last'].includes(term.toLowerCase())) return true
  const dash = term.indexOf('-')
  if (dash < 0) return positivePage(term) !== undefined
  const start = trimGoWhitespace(term.slice(0, dash))
  const end = trimGoWhitespace(term.slice(dash + 1))
  const first = start ? positivePage(start) : undefined
  const last = end ? positivePage(end) : undefined
  if ((start && first === undefined) || (end && last === undefined)) return false
  if (first === undefined) return last !== undefined
  return last === undefined || first <= last
}

export function isPdfPageSelector(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (trimGoWhitespace(value).toLowerCase() === 'all' || value.split(',').every(validTerm))
  )
}

/** A 9.0/9.1 server cannot resolve 9.2 exclusions or open-ended ranges. */
export function hasGotenberg92PageSyntax(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.split(',').some((part) => {
    const token = trimGoWhitespace(part)
    if (token.startsWith('!')) return true
    const dash = token.indexOf('-')
    if (dash < 0) return false
    const start = trimGoWhitespace(token.slice(0, dash))
    const end = trimGoWhitespace(token.slice(dash + 1))
    return (
      (!start && positivePage(end) !== undefined) || (!end && positivePage(start) !== undefined)
    )
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
