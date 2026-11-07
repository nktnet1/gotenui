/** Options shared by Gotenberg 9.1's remediate stage across PDF workflows. */
export const V9_REMEDIATION_FIELD_NAMES = ['v9Language', 'v9Aggressive', 'v9FigureAltText'] as const

export function v9RemediationOptions(fields: Readonly<Record<string, string | boolean>>): {
  language?: string
  aggressive?: boolean
  figureAltText?: string
} {
  const language = typeof fields.v9Language === 'string' ? fields.v9Language.trim() : ''
  const figureAltText = typeof fields.v9FigureAltText === 'string' ? fields.v9FigureAltText : ''
  return {
    ...(language ? { language } : {}),
    ...(fields.v9Aggressive === true ? { aggressive: true } : {}),
    ...(figureAltText !== '' ? { figureAltText } : {}),
  }
}
