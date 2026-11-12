/** Gotenberg 9.4 stamp anchors, shared by the standalone tools and PDF pipelines. */
export const PDF_STAMP_POSITIONS = [
  'center',
  'top-left',
  'top',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const

export function isPdfStampPosition(value: unknown): value is (typeof PDF_STAMP_POSITIONS)[number] {
  return typeof value === 'string' && (PDF_STAMP_POSITIONS as readonly string[]).includes(value)
}
