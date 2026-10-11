/**
 * The default pdfcpu PDF engine accepts overlay appearance as JSON key/value
 * pairs. Keep the Gotenberg wire format intact so both the standalone overlay
 * routes and conversion-time repeated overlays share the same editor.
 */
export const OVERLAY_APPEARANCE_FIELDS = [
  {
    name: 'opacity',
    label: 'Opacity',
    placeholder: '1 (opaque)',
    hint: '0 (invisible) to 1 (opaque)',
    inputMode: 'decimal',
  },
  {
    name: 'rotation',
    label: 'Rotation (degrees)',
    placeholder: '0',
    hint: '-180 to 180 degrees',
    inputMode: 'decimal',
  },
  {
    name: 'scalefactor',
    label: 'Scale factor',
    placeholder: '0.5',
    hint: 'Greater than zero and up to 1; choose relative or absolute scaling below',
    inputMode: 'decimal',
  },
  {
    name: 'offset',
    label: 'Offset (X Y)',
    placeholder: '0 0',
    hint: 'Two numeric offsets in PDF points, separated by a space',
    inputMode: 'text',
  },
  {
    name: 'points',
    label: 'Text size (pt)',
    placeholder: '24',
    hint: 'Whole number between 1 and 500',
    inputMode: 'numeric',
    textOnly: true,
  },
  {
    name: 'fontname',
    label: 'Font name',
    placeholder: 'Helvetica',
    hint: 'Installed pdfcpu font, such as Helvetica or Courier',
    inputMode: 'text',
    textOnly: true,
  },
  {
    name: 'color',
    label: 'Text colour',
    placeholder: '#808080',
    hint: 'Hex RGB colour, for example #008000',
    inputMode: 'text',
    textOnly: true,
  },
] as const

export type OverlayScaleMode = 'rel' | 'abs'

export type OverlayAppearanceKey = (typeof OVERLAY_APPEARANCE_FIELDS)[number]['name'] | 'position'

export const OVERLAY_POSITIONS = [
  ['tl', 'Top left'],
  ['tc', 'Top centre'],
  ['tr', 'Top right'],
  ['l', 'Centre left'],
  ['c', 'Centre'],
  ['r', 'Centre right'],
  ['bl', 'Bottom left'],
  ['bc', 'Bottom centre'],
  ['br', 'Bottom right'],
] as const

export function parseOverlayAppearance(raw: string | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Render a known field even when a legacy options object used an alias. */
export function overlayAppearanceValue(
  raw: string | undefined,
  name: OverlayAppearanceKey,
): string {
  const parsed = parseOverlayAppearance(raw)
  if (!parsed) return ''
  const value =
    name === 'fontname'
      ? (parsed.fontname ?? parsed.font)
      : name === 'scalefactor'
        ? (parsed.scalefactor ?? parsed.scale)
        : parsed[name]
  if (value === undefined || value === null) return ''
  if (
    name === 'scalefactor' &&
    typeof value === 'string' &&
    /^\d*\.?\d+\s+(?:rel|abs)$/.test(value)
  ) {
    return value.replace(/\s+(?:rel|abs)$/, '')
  }
  return String(value)
}

export function overlayScaleMode(raw: string | undefined): OverlayScaleMode {
  const parsed = parseOverlayAppearance(raw)
  const value = parsed?.scalefactor ?? parsed?.scale
  return typeof value === 'string' && /\s+abs$/.test(value) ? 'abs' : 'rel'
}

export function updateOverlayScaleMode(raw: string | undefined, mode: OverlayScaleMode): string {
  const current = parseOverlayAppearance(raw)
  if (!current) throw new Error('Fix the options JSON before editing appearance controls.')
  if (mode === 'rel' && current.points !== undefined) {
    throw new Error('Text size requires absolute scaling. Clear text size first.')
  }
  const factor = overlayAppearanceValue(raw, 'scalefactor')
  const value = factor ? finiteNumber(factor, 'Scale factor', 0, 1) : mode === 'abs' ? 1 : 0.5
  if (value === 0) throw new Error('Scale factor must be greater than zero.')
  const next: Record<string, unknown> = { ...current, scalefactor: `${value} ${mode}` }
  delete next.scale
  return JSON.stringify(next)
}

function finiteNumber(value: string, label: string, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`)
  }
  return num
}

/** Preserve additional engine-specific keys when a native control changes. */
export function updateOverlayAppearance(
  raw: string | undefined,
  name: OverlayAppearanceKey,
  input: string,
): string {
  const existing = parseOverlayAppearance(raw)
  if (!existing) throw new Error('Fix the options JSON before editing appearance controls.')
  const next = { ...existing }
  const value = input.trim()
  if (name === 'fontname') delete next.font
  if (name === 'scalefactor') delete next.scale
  if (!value) {
    delete next[name]
  } else {
    switch (name) {
      case 'opacity':
        next[name] = finiteNumber(value, 'Opacity', 0, 1)
        break
      case 'rotation':
        next[name] = finiteNumber(value, 'Rotation', -180, 180)
        break
      case 'points': {
        const size = finiteNumber(value, 'Text size', 1, 500)
        if (!Number.isInteger(size)) throw new Error('Text size must be a whole number.')
        next[name] = size
        // pdfcpu ignores explicit text points while using relative scaling.
        if (overlayScaleMode(raw) !== 'abs') {
          next.scalefactor = '1 abs'
          delete next.scale
        }
        break
      }
      case 'scalefactor': {
        const scale = finiteNumber(value, 'Relative size', 0, 1)
        if (scale === 0) throw new Error('Relative size must be greater than zero.')
        next[name] = `${scale} ${overlayScaleMode(raw)}`
        break
      }
      case 'position':
        if (!OVERLAY_POSITIONS.some(([position]) => position === value)) {
          throw new Error('Choose a supported page position.')
        }
        next[name] = value
        break
      case 'offset': {
        const offsets = value.split(/\s+/)
        if (offsets.length !== 2 || offsets.some((offset) => !/^-?\d+(?:\.\d+)?$/.test(offset))) {
          throw new Error('Offset must contain two numbers separated by a space (e.g. 12 -5).')
        }
        next[name] = offsets.join(' ')
        break
      }
      case 'color':
        if (!/^#[0-9a-f]{6}$/i.test(value)) {
          throw new Error('Text colour must be a six-digit hex code (e.g. #008000).')
        }
        next[name] = value
        break
      case 'fontname':
        if (!/^[\w .-]{1,80}$/.test(value)) {
          throw new Error('Font name may contain only letters, digits, spaces, dots and hyphens.')
        }
        next[name] = value
        break
    }
  }
  return Object.keys(next).length ? JSON.stringify(next) : ''
}

/** Text-only keys are invalid for an image/PDF overlay in pdfcpu. */
export function removeTextOverlayAppearance(raw: string | undefined): string | undefined {
  const next = parseOverlayAppearance(raw)
  if (!next) return raw
  for (const key of [
    'font',
    'fontname',
    'points',
    'color',
    'fillcolor',
    'strokecolor',
    'aligntext',
  ]) {
    delete next[key]
  }
  return Object.keys(next).length ? JSON.stringify(next) : undefined
}
