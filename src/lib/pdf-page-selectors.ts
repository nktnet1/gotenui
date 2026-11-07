/** Gotenberg 9 accepts litho ranges, odd/even and last, plus `all` on its own.
 * Resolving a selector against the document's page count belongs upstream.
 */
const range =
  /^(?:[1-9]\d*(?:-[1-9]\d*)?|odd|even|last)(?:\s*,\s*(?:[1-9]\d*(?:-[1-9]\d*)?|odd|even|last))*$/i

export function isPdfPageSelector(value: unknown): value is string {
  return (
    typeof value === 'string' && (value.trim().toLowerCase() === 'all' || range.test(value.trim()))
  )
}
