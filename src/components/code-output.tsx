import { useMemo } from 'react'
import { cn } from '#/lib/utils'

/** Use the same read-only code surface for both themes throughout the workspace. */
export const codeOutputClasses =
  'overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 whitespace-pre text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100'

type JsonTokenKind = 'plain' | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation'
export type JsonToken = { text: string; kind: JsonTokenKind; start: number }

// The debug endpoint returns JSON, not an arbitrary code language. Match complete JSON
// strings first so punctuation and keywords inside a string are never highlighted as code.
const jsonLexemes =
  /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/g

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let offset = 0
  for (const match of text.matchAll(jsonLexemes)) {
    const start = match.index
    if (start > offset)
      tokens.push({ text: text.slice(offset, start), kind: 'plain', start: offset })
    const value = match[0]
    const end = start + value.length
    let kind: JsonTokenKind
    if (value.startsWith('"')) {
      kind = /^\s*:/.test(text.slice(end)) ? 'key' : 'string'
    } else if (value === 'true' || value === 'false') {
      kind = 'boolean'
    } else if (value === 'null') {
      kind = 'null'
    } else if (/^-?\d/.test(value)) {
      kind = 'number'
    } else {
      kind = 'punctuation'
    }
    tokens.push({ text: value, kind, start })
    offset = end
  }
  if (offset < text.length) tokens.push({ text: text.slice(offset), kind: 'plain', start: offset })
  return tokens
}

const tokenColors: Record<JsonTokenKind, string> = {
  plain: '',
  key: 'text-sky-700 dark:text-sky-300',
  string: 'text-emerald-700 dark:text-emerald-300',
  number: 'text-amber-700 dark:text-amber-300',
  boolean: 'text-violet-700 dark:text-violet-300',
  null: 'text-slate-500 dark:text-slate-400',
  punctuation: 'text-slate-500 dark:text-slate-400',
}

/** Highlights valid JSON without HTML injection or a syntax-highlighter dependency. */
export function JsonCodeOutput({ value }: { value: string }) {
  const tokens = useMemo(() => tokenizeJson(value), [value])
  return (
    <pre data-slot="json-code-output" className={cn(codeOutputClasses, 'max-h-[50vh]')}>
      <code>
        {tokens.map((token) =>
          token.kind === 'plain' ? (
            token.text
          ) : (
            <span
              key={token.start}
              data-json-token={token.kind}
              className={tokenColors[token.kind]}
            >
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  )
}
