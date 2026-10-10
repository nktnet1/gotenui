/** Presentation preferences only: they do not authorise or block proxy endpoints. */
export type UiFeatures = Readonly<{
  showDebug: boolean
  showMetrics: boolean
}>

function visible(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '' || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false.`)
}

export function uiFeatures(env: NodeJS.ProcessEnv): UiFeatures {
  return {
    showDebug: visible(env.GOTENUI_SHOW_DEBUG, 'GOTENUI_SHOW_DEBUG'),
    showMetrics: visible(env.GOTENUI_SHOW_METRICS, 'GOTENUI_SHOW_METRICS'),
  }
}
