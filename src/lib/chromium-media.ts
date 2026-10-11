/** Common CSS media features supported by Chromium's emulatedMediaFeatures form field.
 * Keep the human-facing selections separate from Gotenberg's JSON wire format.
 */
export const CHROMIUM_MEDIA_OPTIONS = [
  {
    name: 'mediaColorScheme',
    mediaName: 'prefers-color-scheme',
    label: 'Preferred colour scheme',
    options: ['light', 'dark'],
    description: 'Render light- or dark-mode CSS regardless of the server theme.',
  },
  {
    name: 'mediaReducedMotion',
    mediaName: 'prefers-reduced-motion',
    label: 'Reduced motion',
    options: ['no-preference', 'reduce'],
    description: 'Control motion-sensitive CSS and animations.',
  },
  {
    name: 'mediaColorGamut',
    mediaName: 'color-gamut',
    label: 'Colour gamut',
    options: ['srgb', 'p3', 'rec2020'],
    description: 'Emulate display colour-range support.',
  },
  {
    name: 'mediaForcedColors',
    mediaName: 'forced-colors',
    label: 'Forced colours',
    options: ['none', 'active'],
    description: 'Simulate a high-contrast display mode.',
  },
] as const

/** The four pseudo-fields must NEVER be transmitted as individual multipart fields. */
export function encodeChromiumMediaFeatures(
  fields: Readonly<Record<string, string | boolean>>,
): string | undefined {
  const selected = CHROMIUM_MEDIA_OPTIONS.flatMap(({ name, mediaName, options }) => {
    const value = fields[name]
    if (value === '' || value === undefined) return []
    if (typeof value !== 'string' || !options.some((option) => option === value)) {
      throw new Error(`Invalid Chromium media feature ${name}.`)
    }
    return [{ name: mediaName, value }]
  })
  return selected.length ? JSON.stringify(selected) : undefined
}

/** Advanced JSON remains available for non-standard Chromium media features. */
export function validateAdvancedMediaFeatures(value: string): void {
  let rows: unknown
  try {
    rows = JSON.parse(value)
  } catch {
    throw new Error('emulatedMediaFeatures must contain a JSON array.')
  }
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > 16 ||
    rows.some((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return true
      const feature = row as Record<string, unknown>
      return (
        Object.keys(feature).length !== 2 ||
        typeof feature.name !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(feature.name) ||
        typeof feature.value !== 'string' ||
        !feature.value ||
        feature.value.length > 128 ||
        /[\r\n]/.test(feature.value)
      )
    })
  ) {
    throw new Error('emulatedMediaFeatures must contain up to 16 name/value pairs.')
  }
}
