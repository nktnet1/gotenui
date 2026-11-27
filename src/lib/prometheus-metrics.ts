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

const metadata = new RegExp(
  `^[ \t]*#[ \t]*(HELP|TYPE|UNIT)[ \t]+(${metricName})(?:[ \t]+([^\r\n]*)|$)$`,
)
const metadataDirective = /^[ \t]*#[ \t]*(?:HELP|TYPE|UNIT)(?:[ \t]|$)/
const metricTypes = new Set([
  'counter',
  'gauge',
  'histogram',
  'gaugehistogram',
  'summary',
  'info',
  'stateset',
  'unknown',
  'untyped',
])

function metricDeclaration(line: string): RegExpExecArray | null {
  const declaration = metadata.exec(line)
  if (declaration?.[1] === 'TYPE' && !metricTypes.has(declaration[3]?.replace(/[ \t]+$/, '') ?? ''))
    return null
  return declaration
}

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
    const declaration = metricDeclaration(line)
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
export function isPrometheusMetrics(text: string, openMetrics = false): boolean {
  const lines = text.split(/\r?\n/)
  if (!openMetrics && text.trim() === '# EOF') return true
  // Metadata does not excuse malformed sample lines. A gateway may append
  // an error page to an otherwise valid scrape, or include a HELP line in it.
  let recognized = false
  let ended = false
  for (const line of lines) {
    if (!line.trim()) continue
    if (ended) return false
    if (openMetrics && line === '# EOF') {
      ended = true
      recognized = true
      continue
    }
    if (line.trimStart().startsWith('#')) {
      if (metricDeclaration(line)) recognized = true
      else if (metadataDirective.test(line)) return false
      continue
    }
    if (sampleName(line) === undefined) return false
    recognized = true
  }
  return recognized && (!openMetrics || ended)
}

export function filterPrometheusMetrics(text: string, query: string): string {
  const term = query.trim().toLowerCase()
  if (!term) return text
  return text
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(term))
    .join('\n')
}
