/** Names accepted by Gotenberg 9.5+ for page sizing and PDF composition. */
export const PDF_PAPER_SIZES = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B4',
  'B5',
  'Letter',
  'Legal',
  'Tabloid',
] as const

/** These three presets were added in Gotenberg 9.5. */
export function isGotenberg95PaperSize(value: unknown): boolean {
  return typeof value === 'string' && /^(?:A0|A1|A2)$/i.test(value)
}
