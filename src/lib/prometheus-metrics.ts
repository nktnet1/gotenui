const metricName = '[a-zA-Z_:][a-zA-Z0-9_:]*'
const sampleHead = new RegExp(`^[ \t]*(${metricName})`)
const number = /^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[+-]?Inf|NaN)$/

/** Recognize sample lines without running a nested regular expression over
 * potentially large quoted label values or malformed label lists.
 */
function sampleName(line: string): string | undefined {
  const head = sampleHead.exec(line)
  if (!head) return undefined
  let position = head[0].length
  const whitespace = () => {
    const start = position
    while (line[position] === ' ' || line[position] === '\t') position++
    return position > start
  }
  const labelName = /[a-zA-Z_][a-zA-Z0-9_]*/y
  const labelSet = () => {
    if (line[position++] !== '{') return false
    whitespace()
    while (line[position] !== '}') {
      labelName.lastIndex = position
      if (!labelName.test(line)) return false
      position = labelName.lastIndex
      whitespace()
      if (line[position++] !== '=') return false
      whitespace()
      if (line[position++] !== '"') return false
      while (position < line.length && line[position] !== '"') {
        if (line[position++] === '\\' && !['"', '\\', 'n'].includes(line[position++] ?? ''))
          return false
      }
      if (line[position++] !== '"') return false
      whitespace()
      if (line[position] === '}') break
      if (line[position++] !== ',') return false
      whitespace()
    }
    position++
    return true
  }
  const numericToken = () => {
    const start = position
    while (position < line.length && line[position] !== ' ' && line[position] !== '\t') position++
    return number.test(line.slice(start, position))
  }
  let separated = whitespace()
  if (line[position] === '{') {
    if (!labelSet()) return undefined
    separated = whitespace()
  }
  if (!separated || !numericToken()) return undefined
  if (whitespace() && position < line.length && line[position] !== '#') {
    if (!numericToken()) return undefined
    whitespace()
  }
  // OpenMetrics allows an exemplar after the sample value and timestamp.
  if (line[position] === '#') {
    position++
    if (!whitespace() || !labelSet() || !whitespace() || !numericToken()) return undefined
    if (whitespace() && position < line.length && !numericToken()) return undefined
    whitespace()
  }
  return position === line.length ? head[1] : undefined
}

const metadata = new RegExp(`^# (HELP|TYPE|UNIT) (${metricName})(?:[ \\t]+(.*)|$)`)
const derivedSuffixes: Readonly<Record<string, readonly string[]>> = {
  counter: ['total', 'created'],
  histogram: ['bucket', 'count', 'sum', 'created'],
  gaugehistogram: ['bucket', 'gcount', 'gsum'],
  summary: ['count', 'sum', 'created'],
  info: ['info'],
}

/** Summarize Prometheus exposition, including untyped sample-only metrics. */
export function summarizePrometheusMetrics(text: string): {
  families: number
  samples: number
} {
  const declared = new Set<string>()
  const sampled = new Set<string>()
  const derived = new Set<string>()
  let samples = 0
  for (const line of text.split(/\r?\n/)) {
    const declaration = metadata.exec(line)
    if (declaration) {
      const [, kind, family, details] = declaration
      declared.add(family)
      if (kind === 'TYPE') {
        const suffixes = derivedSuffixes[details?.trim() ?? '']
        if (Array.isArray(suffixes)) {
          for (const suffix of suffixes) derived.add(`${family}_${suffix}`)
        }
      }
    } else {
      const name = sampleName(line)
      if (name) {
        sampled.add(name)
        samples++
      }
    }
  }
  // Histograms, summaries and counters may expose multiple sample names for
  // one declared family. Do not count those as separate untyped families.
  for (const name of sampled) {
    if (!derived.has(name)) declared.add(name)
  }
  return { families: declared.size, samples }
}

/** Reject HTML fallbacks and unrelated text masquerading as a metrics response. */
export function isPrometheusMetrics(text: string): boolean {
  const lines = text.split(/\r?\n/)
  if (text.trim() === '# EOF' || lines.some((line) => metadata.test(line))) return true
  // For untyped exposition, require sample syntax on every non-comment line
  // rather than mistaking one metric-like line inside unrelated text for a scrape.
  let foundSample = false
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (sampleName(line) === undefined) return false
    foundSample = true
  }
  return foundSample
}

export function filterPrometheusMetrics(text: string, query: string): string {
  const term = query.trim().toLowerCase()
  if (!term) return text
  return text
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(term))
    .join('\n')
}
