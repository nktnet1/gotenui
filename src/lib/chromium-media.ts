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

/** Both Gotenberg 8 and 9 bind emulatedMediaFeatures as a map of strings. */
export function encodeChromiumMediaFeatures(
  fields: Readonly<Record<string, string | boolean>>,
): string | undefined {
  const selected = CHROMIUM_MEDIA_OPTIONS.flatMap(({ name, mediaName, options }) => {
    const value = fields[name]
    if (value === '' || value === undefined) return []
    if (typeof value !== 'string' || !options.some((option) => option === value)) {
      throw new Error(`Invalid Chromium media feature ${name}.`)
    }
    return [[mediaName, value]]
  })
  return selected.length ? JSON.stringify(Object.fromEntries(selected)) : undefined
}

/** Accept the official object format and normalise older Gotenui name/value rows. */
export function normalizeAdvancedMediaFeatures(value: string): string {
  let input: unknown
  try {
    input = JSON.parse(value)
  } catch {
    throw new Error('emulatedMediaFeatures must contain a JSON object or legacy name/value array.')
  }
  const result: Record<string, string> = Object.create(null)
  function add(name: unknown, value: unknown) {
    if (typeof name !== 'string' || !name || typeof value !== 'string' || name in result) {
      throw new Error('Duplicate or invalid Chromium media feature name/value pair.')
    }
    result[name] = value
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 2) {
        throw new Error('emulatedMediaFeatures must contain name/value pairs.')
      }
      add(row.name, row.value)
    }
  } else if (input && typeof input === 'object') {
    for (const [name, value] of Object.entries(input)) add(name, value)
  } else {
    throw new Error('emulatedMediaFeatures must contain a JSON object or legacy name/value array.')
  }
  return JSON.stringify(result)
}
