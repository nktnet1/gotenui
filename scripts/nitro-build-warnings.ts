/**
 * Nitro's Vite/Rolldown build puts the SPA dependencies in its server bundle.
 * React client-boundary directives are not meaningful in this (non-RSC) bundle.
 * Do not hide warnings from our own code or any other Rolldown diagnostic.
 */
type BuildLog = {
  code?: string
  message?: string
  id?: string
  loc?: { file?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isBundledDependencyClientDirective(level: string, log: BuildLog): boolean {
  if (
    level !== 'warn' ||
    log.code !== 'MODULE_LEVEL_DIRECTIVE' ||
    !/["']use client["']/.test(log.message ?? '')
  ) {
    return false
  }

  // Only the third-party React markers; project and other directive warnings remain visible.
  const source = log.id ?? log.loc?.file ?? log.message ?? ''
  return /[/\\]node_modules[/\\]/.test(source)
}

/**
 * Nitro 3.0.260903-beta gives its library chunk group a function-valued name
 * without debugName. Rolldown >= 1.2.10 reports that missing diagnostic label.
 * Add a non-enumerable name (as newer Nitro does) without changing chunk names,
 * chunk grouping, or compatibility with older Rolldown versions.
 */
export function labelDynamicChunkGroups(output: unknown): void {
  const outputs: unknown[] = Array.isArray(output) ? output : [output]
  for (const entry of outputs) {
    if (!isRecord(entry) || !isRecord(entry.codeSplitting)) continue
    const groups = entry.codeSplitting.groups
    if (!Array.isArray(groups)) continue

    for (const [index, group] of groups.entries()) {
      if (!isRecord(group) || typeof group.name !== 'function' || group.debugName !== undefined) {
        continue
      }
      Object.defineProperty(group, 'debugName', {
        value: `nitro-group-${index}`,
        configurable: true,
      })
    }
  }
}
