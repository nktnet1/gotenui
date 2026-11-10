/** Mirrors Gotenberg 9's validatePDFDate in pkg/modules/pdf/helpers.go.
 * The year is required; subsequent date/time and UTC offset components are optional.
 */
const pdfDatePattern =
  /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2})?(?:'?(\d{2})'?)?$/

export function isPdfMetadataDate(value: string): boolean {
  // An empty string means leave the field out in Gotenberg.
  if (value === '') return true
  const match = pdfDatePattern.exec(value)
  if (!match) return false
  const limits = [
    [1, 12],
    [1, 31],
    [0, 23],
    [0, 59],
    [0, 59],
  ] as const
  for (const [index, [min, max]] of limits.entries()) {
    const component = match[index + 2]
    if (component !== undefined) {
      const number = Number(component)
      if (number < min || number > max) return false
    }
  }
  if (match[8] !== undefined && (match[7] === undefined || Number(match[8]) > 59)) {
    return false
  }
  return true
}
