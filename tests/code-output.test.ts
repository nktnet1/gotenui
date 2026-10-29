import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { codeOutputClasses, JsonCodeOutput, tokenizeJson } from '#/components/code-output'

describe('theme-aware diagnostic output surfaces', () => {
  it('uses a light surface by default and a muted dark surface in dark mode', () => {
    expect(codeOutputClasses).toContain('bg-slate-50')
    expect(codeOutputClasses).toContain('text-slate-800')
    expect(codeOutputClasses).toContain('border-slate-200')
    expect(codeOutputClasses).toContain('dark:bg-slate-800/60')
    expect(codeOutputClasses).toContain('dark:text-slate-100')
    expect(codeOutputClasses).toContain('dark:border-slate-700')
    expect(codeOutputClasses).not.toContain('bg-slate-950')
  })

  it('highlights keys, values and punctuation while preserving every byte of JSON', () => {
    const source = String.raw`{"message":"escaped \"true\" and 42: <script>","count":-1.25e+3,"ok":true,"off":false,"missing":null,"items":[1,2]}`
    expect(JSON.parse(source)).toBeDefined()
    const tokens = tokenizeJson(source)
    expect(tokens.map((token) => token.text).join('')).toBe(source)
    expect(tokens.filter((token) => token.kind === 'key').map((token) => token.text)).toEqual([
      '"message"',
      '"count"',
      '"ok"',
      '"off"',
      '"missing"',
      '"items"',
    ])
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual([
      String.raw`"escaped \"true\" and 42: <script>"`,
    ])
    expect(tokens.filter((token) => token.kind === 'number').map((token) => token.text)).toEqual([
      '-1.25e+3',
      '1',
      '2',
    ])
    expect(tokens.filter((token) => token.kind === 'boolean').map((token) => token.text)).toEqual([
      'true',
      'false',
    ])
    expect(tokens.filter((token) => token.kind === 'null').map((token) => token.text)).toEqual([
      'null',
    ])
  })

  it('escapes untrusted debug values and renders both light and dark token colours', () => {
    const html = renderToStaticMarkup(
      createElement(JsonCodeOutput, {
        value: JSON.stringify({ html: '<img src=x onerror=alert(1)>', enabled: true, count: 3 }),
      }),
    )
    expect(html).toContain('data-slot="json-code-output"')
    expect(html).toContain('dark:bg-slate-800/60')
    expect(html).toContain('data-json-token="key"')
    expect(html).toContain('text-sky-700 dark:text-sky-300')
    expect(html).toContain('data-json-token="string"')
    expect(html).toContain('text-emerald-700 dark:text-emerald-300')
    expect(html).toContain('data-json-token="boolean"')
    expect(html).toContain('text-violet-700 dark:text-violet-300')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })
})
