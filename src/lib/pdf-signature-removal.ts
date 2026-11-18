/** Gotenberg 9.6 rewriters, as defined in pkg/modules/pdf/stage_types.go. */
export const PDF_REWRITING_STAGES = new Set([
  'merge',
  'split',
  'select',
  'delete',
  'insert',
  'compose',
  'flatten-form',
  'flatten-transparency',
  'convert-colors',
  'redact',
  'optimize',
  'encrypt',
  'decrypt',
  'remediate',
])

/** Standalone tools whose v9 implementation creates a rewriting stage. */
export const PDF_REWRITING_TOOLS = new Set([
  'merge',
  'split',
  'pdfa',
  'optimize',
  'flatten',
  'encrypt',
  'factur-x',
  'compose-pages',
  'select-pages',
  'delete-pages',
  'insert-pages',
  'flatten-transparency',
  'convert-colors',
  'redact',
  'decrypt',
])

/** Add the opt-in only to stages on which upstream accepts it. */
export function withSignatureRemoval<T extends Record<string, unknown>>(
  stages: readonly T[],
  enabled: boolean,
): (T | (T & { dropSignatures: true }))[] {
  if (!enabled) return [...stages]
  return stages.map((stage) =>
    typeof stage.op === 'string' && PDF_REWRITING_STAGES.has(stage.op)
      ? { ...stage, dropSignatures: true }
      : stage,
  )
}
