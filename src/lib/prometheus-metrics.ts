/** Summarize legacy Prometheus exposition without interpreting arbitrary metric values. */
export function summarizePrometheusMetrics(text: string): {
  families: number
  samples: number
} {
  const families = new Set<string>()
  let samples = 0
  for (const line of text.split(/\r?\n/)) {
    const type = /^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*)\s+\S+/.exec(line)
    if (type) {
      families.add(type[1] as string)
    } else if (/^[a-zA-Z_:][a-zA-Z0-9_:]*(?:\{|\s)/.test(line)) {
      samples++
    }
  }
  return { families: families.size, samples }
}

/** Reject HTML fallbacks and unrelated text masquerading as a metrics response. */
export function isPrometheusMetrics(text: string): boolean {
  return /^# (?:HELP|TYPE) [a-zA-Z_:][a-zA-Z0-9_:]*/m.test(text)
}

export function filterPrometheusMetrics(text: string, query: string): string {
  const term = query.trim().toLowerCase()
  if (!term) return text
  return text
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(term))
    .join('\n')
}
