import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'vitest'

/**
 * Execute the actual browser-smoke navigation expressions. In JavaScript a
 * newline before `[` does not terminate a call, which previously made the
 * second click access a property of `undefined` (the first click's result).
 */
test('browser smoke opens the v9 pipeline and settings with independent navigation actions', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const section = source.split('// Keep a v9-only tool selected while changing to v8.')[1]
  assert.ok(section)
  const expressions = [...section.matchAll(/await page\.evaluate\(`([\s\S]*?)`\)/g)]
    .slice(0, 2)
    .map((match) => match[1])
  assert.equal(expressions.length, 2, 'Each navigation action needs its own browser evaluation')

  const clicked: string[] = []
  const pipeline = {
    textContent: 'PDF pipeline builder',
    disabled: false,
    click: () => clicked.push('pipeline'),
  }
  const settings = {
    textContent: 'Connection settings',
    click: () => clicked.push('settings'),
  }
  const document = {
    querySelectorAll: (selector: string) => {
      if (selector === '#gotenui-navigation nav button') return [pipeline]
      if (selector === '#gotenui-navigation button') return [pipeline, settings]
      return []
    },
  }
  for (const expression of expressions) runInNewContext(expression, { document })
  assert.deepEqual(clicked, ['pipeline', 'settings'])
})

test('browser smoke queues an available v8 tool with independent navigation and batch clicks', () => {
  const source = readFileSync(new URL('../scripts/smoke-browser.ts', import.meta.url), 'utf8')
  const section = source.split('// The Diagnostics dialog and queued conversions must follow')[1]
  assert.ok(section, 'Connection-switch browser checks must be present')
  const scripts = [...section.matchAll(/await page\.evaluate\(`\(\(\) => \{([\s\S]*?)\}\)\(\)`\)/g)]
    .map((match) => match[0].slice('await page.evaluate(`'.length, -'`)'.length))
    .filter(
      (script) =>
        script.includes("textContent.trim() === 'HTML to PDF'") ||
        script.includes("textContent.trim() === 'Add to batch'"),
    )
  assert.equal(scripts.length, 2)
  const clicked: string[] = []
  const conversion = {
    textContent: 'HTML to PDF',
    disabled: false,
    click: () => clicked.push('HTML to PDF'),
  }
  const queue = {
    textContent: 'Add to batch',
    disabled: false,
    click: () => clicked.push('Add to batch'),
  }
  const document = {
    querySelectorAll: (selector: string) =>
      selector === '#gotenui-navigation nav button'
        ? [conversion]
        : selector === 'button'
          ? [queue]
          : [],
  }
  for (const script of scripts) runInNewContext(script, { document })
  assert.deepEqual(clicked, ['HTML to PDF', 'Add to batch'])
})
